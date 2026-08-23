"""Diagnóstico ICL y corte en drenajes para keylines.

Fórmulas alineadas con Basdonax Keyline from DEM (GPL-2.0-or-later):
pendiente, radio, longitud, clase hidrológica → ICL y semáforo.
El umbral de cauce es el mismo que en caminos (~2 ha).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from rasterio.transform import rowcol

from crsutil import transformer_from_wgs84, transformer_to_wgs84
from hydrology import get_hydro

# Prefactibilidad: mismos órdenes de magnitud que el plugin, no diseño de obra.
MAX_SLOPE_PCT = 0.50
MIN_RADIUS_M = 12.0
MIN_LENGTH_M = 15.0
DRAIN_BUFFER_M = 5.0
STREAM_AREA_M2 = 20_000.0
GRADE_STEP_M = 12.0
DENSIFY_M = 5.0


def diagnose_and_cut_keylines(
    path: str,
    geojson: dict,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
    stake_m: float = 10.0,
) -> dict:
    hydro = get_hydro(path, resample_pct, gaussian_sigma)
    dem = hydro["dem"]
    acc = hydro["acc"]
    elev = dem["elevation"]
    transform = dem["transform"]
    mx, my = dem["pixel_m"]
    cell_area = max(mx * my, 1e-6)
    stream_cells = max(4.0, STREAM_AREA_M2 / cell_area)
    threshold_area = stream_cells * cell_area
    is_geo = abs(transform.a) < 1
    to_native = transformer_from_wgs84(dem["crs"])
    to_wgs = transformer_to_wgs84(dem["crs"])
    h, w = elev.shape

    def to_xy(lon: float, lat: float) -> tuple[float, float]:
        if to_native is None:
            return lon, lat
        return to_native.transform(lon, lat)

    def to_ll(x: float, y: float) -> tuple[float, float]:
        if to_wgs is None:
            return x, y
        return to_wgs.transform(x, y)

    def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
        if is_geo:
            lat = 0.5 * (a[1] + b[1])
            dx = (b[0] - a[0]) * 111_320 * max(0.2, math.cos(math.radians(lat)))
            dy = (b[1] - a[1]) * 110_540
            return math.hypot(dx, dy)
        return math.hypot(b[0] - a[0], b[1] - a[1])

    def sample_cell(x: float, y: float) -> tuple[float | None, float | None]:
        r, c = rowcol(transform, x, y)
        if r < 0 or c < 0 or r >= h or c >= w:
            return None, None
        z = elev[r, c]
        a = acc[r, c]
        z_out = float(z) if np.isfinite(z) else None
        a_out = float(a) if np.isfinite(a) else None
        return z_out, a_out

    out: list[dict[str, Any]] = []
    for feat in geojson.get("features") or []:
        props = dict(feat.get("properties") or {})
        geom = feat.get("geometry") or {}
        if props.get("type") != "Keyline" or geom.get("type") != "LineString":
            out.append(feat)
            continue

        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue
        pts = [to_xy(float(p[0]), float(p[1])) for p in coords]
        pts = _chaikin(pts, 1)
        pts = _densify(pts, DENSIFY_M, dist_m)
        if len(pts) < 2:
            continue

        chain = _chainage(pts, dist_m)
        zs: list[float | None] = []
        accs: list[float | None] = []
        for x, y in pts:
            z, a = sample_cell(x, y)
            zs.append(z)
            accs.append(a)

        parts, breaks = _split_on_drains(pts, chain, accs, stream_cells)
        for bx, by in breaks:
            lon, lat = to_ll(bx, by)
            out.append(
                {
                    "type": "Feature",
                    "properties": {
                        "type": "DrainBreak",
                        "kind": "drain-break",
                    },
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                }
            )

        kept = 0
        for part_i, part in enumerate(parts, start=1):
            if _length_m(part, dist_m) < MIN_LENGTH_M:
                continue
            kept += 1
            metrics = _line_metrics(
                part,
                dist_m,
                sample_cell,
                stream_cells,
                threshold_area,
            )
            icl, status, review = _icl(
                metrics["length_m"],
                metrics["slope_max"],
                metrics["radius_min"],
                metrics["hyd_cls"],
                metrics["drain_hits"],
            )
            line_props = {
                **props,
                "part": part_i,
                "length_m": round(metrics["length_m"], 1),
                "slope_avg": metrics["slope_avg"],
                "slope_max": metrics["slope_max"],
                "radius_min": metrics["radius_min"],
                "drain_hits": metrics["drain_hits"],
                "hyd_cls": metrics["hyd_cls"],
                "icl": icl,
                "status": status,
                "review": review,
            }
            coords_ll = [list(to_ll(x, y)) for x, y in part]
            out.append(
                {
                    "type": "Feature",
                    "properties": line_props,
                    "geometry": {"type": "LineString", "coordinates": coords_ll},
                }
            )
            if stake_m > 0:
                out.extend(
                    _stakeout_points(part, dist_m, sample_cell, to_ll, stake_m, line_props)
                )

        if kept == 0 and parts:
            # DEM chico: conservar el tramo más largo aunque quede corto.
            part = max(parts, key=lambda p: _length_m(p, dist_m))
            if _length_m(part, dist_m) >= 8.0:
                metrics = _line_metrics(
                    part, dist_m, sample_cell, stream_cells, threshold_area
                )
                icl, status, review = _icl(
                    metrics["length_m"],
                    metrics["slope_max"],
                    metrics["radius_min"],
                    metrics["hyd_cls"],
                    metrics["drain_hits"],
                )
                line_props = {
                    **props,
                    "part": 1,
                    "length_m": round(metrics["length_m"], 1),
                    "slope_avg": metrics["slope_avg"],
                    "slope_max": metrics["slope_max"],
                    "radius_min": metrics["radius_min"],
                    "drain_hits": metrics["drain_hits"],
                    "hyd_cls": metrics["hyd_cls"],
                    "icl": icl,
                    "status": status,
                    "review": review or "linea corta",
                }
                coords_ll = [list(to_ll(x, y)) for x, y in part]
                out.append(
                    {
                        "type": "Feature",
                        "properties": line_props,
                        "geometry": {"type": "LineString", "coordinates": coords_ll},
                    }
                )
                if stake_m > 0:
                    out.extend(
                        _stakeout_points(part, dist_m, sample_cell, to_ll, stake_m, line_props)
                    )

    return {"type": "FeatureCollection", "features": out}


def summarize_keylines(geojson: dict) -> dict[str, int]:
    counts = {
        "ACEPTAR": 0,
        "REVISAR": 0,
        "AJUSTAR": 0,
        "REDISENAR": 0,
        "cortes": 0,
        "replanteo": 0,
    }
    for feat in geojson.get("features") or []:
        props = feat.get("properties") or {}
        kind = props.get("type")
        if kind == "DrainBreak":
            counts["cortes"] += 1
        elif kind == "Stakeout":
            counts["replanteo"] += 1
        elif kind == "Keyline":
            status = props.get("status")
            if status in counts:
                counts[status] += 1
    return counts


def _interpolate_chain(
    pts: list[tuple[float, float]], chain: list[float], m: float
) -> tuple[float, float]:
    if m <= chain[0]:
        return pts[0]
    if m >= chain[-1]:
        return pts[-1]
    for i in range(1, len(chain)):
        if chain[i] >= m:
            span = chain[i] - chain[i - 1]
            t = 0.0 if span <= 0 else (m - chain[i - 1]) / span
            a, b = pts[i - 1], pts[i]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    return pts[-1]


def _stakeout_points(
    pts: list[tuple[float, float]],
    dist_m,
    sample_cell,
    to_ll,
    step_m: float,
    line_props: dict[str, Any],
) -> list[dict[str, Any]]:
    chain = _chainage(pts, dist_m)
    total = chain[-1] if chain else 0.0
    if total < 1.0:
        return []
    marks = list(np.arange(0.0, total, max(step_m, 1.0)))
    if not marks or marks[-1] < total - 0.4:
        marks.append(total)
    out: list[dict[str, Any]] = []
    for i, m in enumerate(marks, start=1):
        x, y = _interpolate_chain(pts, chain, float(m))
        z, _acc = sample_cell(x, y)
        lon, lat = to_ll(x, y)
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "type": "Stakeout",
                    "kind": "stakeout",
                    "index": line_props.get("index"),
                    "part": line_props.get("part"),
                    "pt_id": i,
                    "chain_m": round(float(m), 1),
                    "z": None if z is None else round(z, 2),
                    "status": line_props.get("status"),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return out


def _chaikin(
    pts: list[tuple[float, float]], iterations: int
) -> list[tuple[float, float]]:
    if len(pts) < 3 or iterations <= 0:
        return pts
    cur = pts
    for _ in range(iterations):
        nxt: list[tuple[float, float]] = [cur[0]]
        for a, b in zip(cur, cur[1:]):
            nxt.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            nxt.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        nxt.append(cur[-1])
        cur = nxt
    return cur


def _densify(
    pts: list[tuple[float, float]],
    step_m: float,
    dist_m,
) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return pts
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = dist_m(a, b)
        n = max(1, int(d / max(step_m, 0.2)))
        for i in range(1, n + 1):
            t = i / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def _chainage(pts: list[tuple[float, float]], dist_m) -> list[float]:
    chain = [0.0]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        acc += dist_m(a, b)
        chain.append(acc)
    return chain


def _length_m(pts: list[tuple[float, float]], dist_m) -> float:
    return sum(dist_m(a, b) for a, b in zip(pts, pts[1:]))


def _split_on_drains(
    pts: list[tuple[float, float]],
    chain: list[float],
    accs: list[float | None],
    stream_cells: float,
) -> tuple[list[list[tuple[float, float]]], list[tuple[float, float]]]:
    n = len(pts)
    drain = [
        a is not None and a >= stream_cells
        for a in accs
    ]
    if not any(drain):
        return [pts], []

    drop = [False] * n
    for i, flag in enumerate(drain):
        if not flag:
            continue
        ci = chain[i]
        for j, cj in enumerate(chain):
            if abs(cj - ci) <= DRAIN_BUFFER_M:
                drop[j] = True

    parts: list[list[tuple[float, float]]] = []
    breaks: list[tuple[float, float]] = []
    current: list[tuple[float, float]] = []
    in_break = False
    for i, pt in enumerate(pts):
        if drop[i]:
            if current and len(current) >= 2:
                parts.append(current)
            current = []
            if not in_break:
                breaks.append(pt)
            in_break = True
            continue
        in_break = False
        current.append(pt)
    if current and len(current) >= 2:
        parts.append(current)
    return parts, breaks


def _line_metrics(
    pts: list[tuple[float, float]],
    dist_m,
    sample_cell,
    stream_cells: float,
    threshold_area: float,
):
    length = _length_m(pts, dist_m)
    zs: list[float] = []
    chain: list[float] = []
    accs: list[float] = []
    travelled = 0.0
    for i, pt in enumerate(pts):
        if i:
            travelled += dist_m(pts[i - 1], pt)
        z, a = sample_cell(pt[0], pt[1])
        if z is None:
            continue
        zs.append(z)
        chain.append(travelled)
        if a is not None:
            accs.append(a)

    slope_avg = None
    slope_max = None
    if len(zs) >= 2 and chain[-1] > 0:
        sample_d = np.arange(0.0, chain[-1] + GRADE_STEP_M * 0.5, GRADE_STEP_M)
        if sample_d.size < 2:
            sample_d = np.array([0.0, chain[-1]])
        sample_z = np.interp(sample_d, chain, zs)
        grades = np.diff(sample_z) / np.maximum(np.diff(sample_d), 1e-6) * 100.0
        grades = grades[np.isfinite(grades)]
        if grades.size:
            slope_avg = round(float(np.mean(np.abs(grades))), 3)
            slope_max = round(float(np.max(np.abs(grades))), 3)

    radius = _min_radius(pts, dist_m)
    drain_hits = _drain_runs(accs, stream_cells)
    facc_max = max(accs) if accs else None
    hyd_cls = _hyd_class(facc_max, drain_hits, threshold_area)
    return {
        "length_m": length,
        "slope_avg": slope_avg,
        "slope_max": slope_max,
        "radius_min": None if radius is None else round(radius, 1),
        "drain_hits": drain_hits,
        "hyd_cls": hyd_cls,
    }


def _drain_runs(accs: list[float], stream_cells: float) -> int:
    hits = 0
    inside = False
    for a in accs:
        flag = a >= stream_cells
        if flag and not inside:
            hits += 1
        inside = flag
    return hits


def _hyd_class(
    facc_max: float | None, drain_hits: int, threshold_area: float
) -> str:
    if facc_max is None:
        return "NA"
    ratio = facc_max / max(threshold_area, 1e-9)
    if drain_hits > 0 and ratio >= 1.0:
        if ratio >= 5.0:
            return "E"
        if ratio >= 2.0:
            return "D"
        return "C"
    if ratio < 0.25:
        return "A"
    if ratio < 0.50:
        return "B"
    if ratio < 1.00:
        return "C"
    if ratio < 2.00:
        return "D"
    return "E"


def _min_radius(pts: list[tuple[float, float]], dist_m) -> float | None:
    if len(pts) < 3:
        return None
    best: float | None = None
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        ab = dist_m(a, b)
        bc = dist_m(b, c)
        ca = dist_m(c, a)
        if ab < 2.0 or bc < 2.0:
            continue
        # Área en m²: para CRS métrico el producto cruzado está en unidades nativas.
        # dist_m ya devolvió metros; reconstruimos un triángulo local en metros.
        if ca <= 0:
            continue
        x = (ab * ab + ca * ca - bc * bc) / (2 * ab)
        y2 = ca * ca - x * x
        if y2 <= 1e-8:
            continue
        area = 0.5 * ab * math.sqrt(y2)
        if area <= 1e-8:
            continue
        r = (ab * bc * ca) / (4.0 * area)
        if best is None or r < best:
            best = r
    return best


def _icl(
    length_m: float,
    slope_max_pct: float | None,
    radius_min: float | None,
    hyd_cls: str,
    drain_hits: int,
) -> tuple[float, str, str]:
    review: list[str] = []

    if slope_max_pct is None:
        score_slope = 0
        review.append("sin pendiente")
    elif slope_max_pct <= 0.5 * MAX_SLOPE_PCT:
        score_slope = 30
    elif slope_max_pct <= MAX_SLOPE_PCT:
        score_slope = 24
    elif slope_max_pct <= 1.5 * MAX_SLOPE_PCT:
        score_slope = 14
        review.append("pendiente alta")
    elif slope_max_pct <= 2.0 * MAX_SLOPE_PCT:
        score_slope = 6
        review.append("pendiente muy alta")
    else:
        score_slope = 0
        review.append("pendiente critica")

    if radius_min is None:
        score_radius = 12
        review.append("radio no calculado")
    elif radius_min >= 1.5 * MIN_RADIUS_M:
        score_radius = 20
    elif radius_min >= MIN_RADIUS_M:
        score_radius = 16
    elif radius_min >= 0.75 * MIN_RADIUS_M:
        score_radius = 8
        review.append("radio bajo")
    else:
        score_radius = 0
        review.append("radio critico")

    if length_m < MIN_LENGTH_M:
        score_length = 0
        review.append("linea corta")
    elif length_m <= 200.0:
        score_length = 15
    elif length_m <= 250.0:
        score_length = 8
        review.append("longitud alta")
    else:
        score_length = 0
        review.append("longitud critica")

    if hyd_cls == "A":
        score_hydro = 25
    elif hyd_cls == "B":
        score_hydro = 21
    elif hyd_cls == "C":
        score_hydro = 14
        if drain_hits > 0:
            review.append("intercepta drenaje potencial")
    elif hyd_cls == "D":
        score_hydro = 6
        review.append("acumulacion alta")
    elif hyd_cls == "E":
        score_hydro = 0
        review.append("acumulacion critica")
    else:
        score_hydro = 10
        review.append("hidrologia no evaluada")

    icl = float(score_slope + score_radius + score_length + 10 + score_hydro)
    if icl >= 85:
        status = "ACEPTAR"
    elif icl >= 70:
        status = "REVISAR"
    elif icl >= 55:
        status = "AJUSTAR"
    else:
        status = "REDISENAR"
    return icl, status, "; ".join(review)
