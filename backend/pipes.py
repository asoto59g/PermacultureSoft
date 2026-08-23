"""Gravity pipe design: hydrostatic head, Hazen–Williams, PN class, BoQ."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import rasterio
from shapely.geometry import LineString, mapping
from shapely.ops import transform as shp_transform

from crsutil import transformer_from_wgs84
from ecosystems import _utm_epsg
from hydrology import calculate_gravity_pressure
from pyproj import Transformer

DN_MM = (25, 32, 40, 50, 63, 75, 90, 110, 160, 200, 250)
PN_BAR = (6.0, 8.0, 10.0, 12.5, 16.0, 20.0)

# Reference unit prices USD (PE100, not a quote).
PRICE_M = {
    25: 1.4,
    32: 1.8,
    40: 2.4,
    50: 3.2,
    63: 4.6,
    75: 6.2,
    90: 8.8,
    110: 12.5,
    160: 23.0,
    200: 36.0,
    250: 55.0,
}
PRICE_ELBOW = {dn: round(p * 0.9, 2) for dn, p in PRICE_M.items()}


def recommend_pn(pressure_bar: float, safety: float = 1.25) -> float:
    need = max(0.0, pressure_bar) * safety
    for pn in PN_BAR:
        if pn >= need:
            return pn
    return PN_BAR[-1]


def hazen_williams_hf(length_m: float, q_m3s: float, dn_mm: float, c: float = 150.0) -> float:
    if length_m <= 0 or q_m3s <= 0 or dn_mm <= 0:
        return 0.0
    d_m = dn_mm / 1000.0
    return 10.67 * length_m * (q_m3s / c) ** 1.852 / (d_m ** 4.87)


def velocity_ms(q_m3s: float, dn_mm: float) -> float:
    if dn_mm <= 0:
        return 0.0
    area = math.pi * (dn_mm / 1000.0) ** 2 / 4.0
    return q_m3s / area if area else 0.0


def _sample_line_elevations(
    src: rasterio.DatasetReader,
    coords_ll: list[list[float]],
    step_m: float = 8.0,
) -> tuple[list[float], float, float]:
    """Returns elevations along the line, 2D length m, 3D length m."""
    if len(coords_ll) < 2:
        return [], 0.0, 0.0
    lon0 = sum(c[0] for c in coords_ll) / len(coords_ll)
    lat0 = sum(c[1] for c in coords_ll) / len(coords_ll)
    epsg = _utm_epsg(lon0, lat0)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    line_utm = shp_transform(to_utm, LineString([(c[0], c[1]) for c in coords_ll]))
    length2d = float(line_utm.length)
    n = max(2, int(math.ceil(length2d / step_m)) + 1)
    to_native = transformer_from_wgs84(src.crs)

    elevs: list[float] = []
    prev_xyz: tuple[float, float, float] | None = None
    length3d = 0.0
    for i in range(n):
        d = min(length2d, (length2d * i) / (n - 1) if n > 1 else 0)
        pt = line_utm.interpolate(d)
        lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform(
            pt.x, pt.y
        )
        x, y = lon, lat
        if to_native is not None:
            x, y = to_native.transform(lon, lat)
        row, col = src.index(x, y)
        if row < 0 or col < 0 or row >= src.height or col >= src.width:
            continue
        z = float(src.read(1, window=rasterio.windows.Window(col, row, 1, 1))[0, 0])
        if src.nodata is not None and z == src.nodata:
            continue
        if not np.isfinite(z) or abs(z) > 1e5:
            continue
        elevs.append(z)
        if prev_xyz is not None:
            dx = (pt.x - prev_xyz[0])
            dy = (pt.y - prev_xyz[1])
            dz = z - prev_xyz[2]
            length3d += math.hypot(math.hypot(dx, dy), dz)
        prev_xyz = (pt.x, pt.y, z)
    if not elevs:
        return [], length2d, length2d
    return elevs, length2d, max(length2d, length3d)


def design_pipe(
    dem_path: str,
    vertices: list[list[float]],
    dn_mm: float = 63,
    pn_bar: float | None = None,
    flow_ls: float = 0.5,
    hw_c: float = 150,
) -> dict[str, Any]:
    if len(vertices) < 2:
        raise ValueError("La tubería necesita al menos dos vértices.")
    dn_mm = float(dn_mm)
    q = max(0.0, float(flow_ls)) / 1000.0
    with rasterio.open(dem_path) as src:
        elevs, length2d, length3d = _sample_line_elevations(src, vertices)
        if not elevs:
            raise ValueError("No hay elevación a lo largo de la tubería (fuera del DEM).")
        z_src = elevs[0]
        z_end = elevs[-1]
        z_min = min(elevs)
        z_max = max(elevs)

    static_end = calculate_gravity_pressure(z_src, z_end)
    static_max = calculate_gravity_pressure(z_src, z_min)
    hf = hazen_williams_hf(length3d, q, dn_mm, hw_c)
    residual_head_m = (z_src - z_end) - hf
    residual_bar = max(0.0, residual_head_m) / 10.197
    v = velocity_ms(q, dn_mm)
    elbows = max(0, len(vertices) - 2)
    pn = float(pn_bar) if pn_bar else recommend_pn(static_max)
    unit = PRICE_M.get(int(dn_mm), 10.0)
    elbow_u = PRICE_ELBOW.get(int(dn_mm), 8.0)
    cost_pipe = length3d * unit
    cost_elbows = elbows * elbow_u

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "kind": "pipe",
                    "dn_mm": dn_mm,
                    "pn_bar": pn,
                    "length_m": round(length3d, 2),
                    "pressure_bar": round(static_end, 3),
                },
                "geometry": mapping(LineString([(v[0], v[1]) for v in vertices])),
            }
        ],
    }

    return {
        "vertices": vertices,
        "dn_mm": dn_mm,
        "pn_bar": pn,
        "pn_recommended": recommend_pn(static_max),
        "flow_ls": flow_ls,
        "hw_c": hw_c,
        "length_2d_m": round(length2d, 2),
        "length_3d_m": round(length3d, 2),
        "elevation_source": round(z_src, 2),
        "elevation_target": round(z_end, 2),
        "elevation_min": round(z_min, 2),
        "elevation_max": round(z_max, 2),
        "pressure_bar": round(static_end, 3),
        "pressure_max_bar": round(static_max, 3),
        "headloss_m": round(hf, 3),
        "residual_bar": round(residual_bar, 3),
        "velocity_ms": round(v, 3),
        "elbows": elbows,
        "boq": [
            {
                "item": f"PE DN{int(dn_mm)} PN{pn:g}",
                "qty": round(length3d, 2),
                "unit": "m",
                "unit_price": unit,
                "total": round(cost_pipe, 2),
            },
            {
                "item": f"Codo PE DN{int(dn_mm)}",
                "qty": elbows,
                "unit": "u",
                "unit_price": elbow_u,
                "total": round(cost_elbows, 2),
            },
        ],
        "cost_ref_usd": round(cost_pipe + cost_elbows, 2),
        "geojson": geojson,
        "notes": (
            "Presión = carga hidrostática. Pérdida Hazen–Williams (C PE≈150). "
            "Precios de referencia, no cotización."
        ),
    }


def aggregate_boq(pipes: list[dict[str, Any]]) -> dict[str, Any]:
    rows: dict[tuple[str, str], dict[str, Any]] = {}
    total = 0.0
    for p in pipes:
        for line in p.get("boq") or []:
            key = (line["item"], line["unit"])
            if key not in rows:
                rows[key] = {
                    "item": line["item"],
                    "qty": 0.0,
                    "unit": line["unit"],
                    "unit_price": line["unit_price"],
                    "total": 0.0,
                }
            rows[key]["qty"] += float(line["qty"])
            rows[key]["total"] += float(line["total"])
            total += float(line["total"])
    out = []
    for row in rows.values():
        row["qty"] = round(row["qty"], 2)
        row["total"] = round(row["total"], 2)
        out.append(row)
    out.sort(key=lambda r: r["item"])
    return {"rows": out, "cost_ref_usd": round(total, 2), "pipe_count": len(pipes)}
