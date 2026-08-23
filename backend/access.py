"""Least-cost road alignment over a DEM, with grade check and earthworks BoQ."""

from __future__ import annotations

from typing import Any

import numpy as np
from rasterio.transform import rowcol, xy
from shapely.geometry import LineString

from crsutil import transformer_from_wgs84, transformer_to_wgs84
from hydrology import get_hydro
from surfaces import terrain_derivatives

# Reference unit prices USD. Preliminary design, not a quote.
PRICE_EXCAVATION_M3 = 4.5
PRICE_BASE_M3 = 22.0
PRICE_CULVERT = 350.0
BASE_THICKNESS_M = 0.20

# Grade is reported on a resampled profile; cell-to-cell grade is DEM noise.
GRADE_STEP_M = 20.0


def _rowcol(dem: dict, lon: float, lat: float) -> tuple[int, int]:
    to_native = transformer_from_wgs84(dem["crs"])
    x, y = (lon, lat) if to_native is None else to_native.transform(lon, lat)
    row, col = rowcol(dem["transform"], x, y)
    h, w = dem["elevation"].shape
    if not (0 <= row < h and 0 <= col < w):
        raise ValueError("Un punto del trazo está fuera del DEM.")
    if not np.isfinite(dem["elevation"][int(row), int(col)]):
        raise ValueError("Un punto del trazo cae en una celda sin elevación.")
    return int(row), int(col)


def _cost_surface(
    elev: np.ndarray,
    slope_pct: np.ndarray,
    acc: np.ndarray,
    max_grade_pct: float,
    stream_cells: float,
) -> np.ndarray:
    ratio = slope_pct / max(max_grade_pct, 0.5)
    cost = 1.0 + 8.0 * np.square(np.clip(ratio, 0, None))
    cost = np.where(slope_pct > max_grade_pct, cost * 6.0, cost)
    cost = np.where(acc >= stream_cells, cost + 25.0, cost)
    cost = np.where(np.isfinite(cost), cost, np.inf)
    return np.where(np.isfinite(elev), cost, np.inf)


def _profile_grades(dist: np.ndarray, elevs: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    total = float(dist[-1]) if len(dist) else 0.0
    if total <= GRADE_STEP_M:
        return np.array([0.0, total]), np.array([elevs[0], elevs[-1]])
    n = max(2, int(total // GRADE_STEP_M) + 1)
    sample_d = np.linspace(0.0, total, n)
    return sample_d, np.interp(sample_d, dist, elevs)


def design_road(
    dem_path: str,
    waypoints: list[list[float]],
    max_grade_pct: float = 12.0,
    width_m: float = 4.0,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
) -> dict[str, Any]:
    if len(waypoints) < 2:
        raise ValueError("El camino necesita al menos dos puntos.")

    hydro = get_hydro(dem_path, resample_pct, gaussian_sigma)
    dem = hydro["dem"]
    acc = hydro["acc"]
    elev = dem["elevation"]
    _, slope_pct, _, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    mx, my = dem["pixel_m"]

    # A "stream" is a channel draining at least ~2 ha.
    cell_area = mx * my
    stream_cells = max(4.0, 20_000.0 / max(cell_area, 1e-6))
    cost = _cost_surface(elev, slope_pct, acc, max_grade_pct, stream_cells)

    from skimage.graph import route_through_array

    cells: list[tuple[int, int]] = []
    for a, b in zip(waypoints, waypoints[1:]):
        start = _rowcol(dem, a[0], a[1])
        end = _rowcol(dem, b[0], b[1])
        try:
            leg, _weight = route_through_array(
                cost, start, end, fully_connected=True, geometric=True
            )
        except Exception as exc:
            raise ValueError(
                "No se encontró ruta entre los puntos (¿hay huecos sin datos en el DEM?)."
            ) from exc
        cells.extend(leg if not cells else leg[1:])

    if len(cells) < 2:
        raise ValueError("El trazo resultante es demasiado corto.")

    rows = np.array([c[0] for c in cells])
    cols = np.array([c[1] for c in cells])
    xs, ys = xy(dem["transform"], rows, cols)
    xs = np.asarray(xs, dtype=float)
    ys = np.asarray(ys, dtype=float)
    z = elev[rows, cols].astype(float)

    to_wgs = transformer_to_wgs84(dem["crs"])
    if to_wgs is None:
        lons, lats = xs, ys
    else:
        lons, lats = to_wgs.transform(xs, ys)
    lons = np.asarray(lons, dtype=float)
    lats = np.asarray(lats, dtype=float)

    # Segment lengths from cell steps (metres), independent of CRS units.
    step_r = np.abs(np.diff(rows)) * my
    step_c = np.abs(np.diff(cols)) * mx
    seg2d = np.hypot(step_r, step_c)
    dz = np.diff(z)
    seg3d = np.hypot(seg2d, np.nan_to_num(dz))
    dist = np.concatenate([[0.0], np.cumsum(seg2d)])

    length_2d = float(dist[-1])
    length_3d = float(np.nansum(seg3d))

    sample_d, sample_z = _profile_grades(dist, z)
    grades = np.diff(sample_z) / np.maximum(np.diff(sample_d), 1e-6) * 100.0
    grades = grades[np.isfinite(grades)]
    max_grade = float(np.max(np.abs(grades))) if grades.size else 0.0
    mean_grade = float(np.mean(np.abs(grades))) if grades.size else 0.0
    over_len = (
        float(np.sum(np.abs(grades) > max_grade_pct) * GRADE_STEP_M) if grades.size else 0.0
    )

    # Balanced cut/fill bench on a side slope: A_cut = A_fill = W^2 * tan(theta) / 8.
    theta = np.arctan(np.clip(slope_pct[rows, cols], 0, 400) / 100.0)
    area_cut = (width_m**2) * np.tan(theta) / 8.0
    seg_area = (area_cut[:-1] + area_cut[1:]) / 2.0
    cut_m3 = float(np.nansum(seg_area * seg2d))

    crossings = _stream_crossings(acc[rows, cols] >= stream_cells, lons, lats, dist)

    surface_m2 = length_2d * width_m
    base_m3 = surface_m2 * BASE_THICKNESS_M
    boq = [
        {
            "item": "Excavación / terraplén (balanceado)",
            "qty": round(cut_m3, 1),
            "unit": "m3",
            "unit_price": PRICE_EXCAVATION_M3,
            "total": round(cut_m3 * PRICE_EXCAVATION_M3, 2),
        },
        {
            "item": f"Base granular e={BASE_THICKNESS_M:g} m",
            "qty": round(base_m3, 1),
            "unit": "m3",
            "unit_price": PRICE_BASE_M3,
            "total": round(base_m3 * PRICE_BASE_M3, 2),
        },
    ]
    if crossings:
        boq.append(
            {
                "item": "Alcantarilla en cruce de cauce",
                "qty": len(crossings),
                "unit": "u",
                "unit_price": PRICE_CULVERT,
                "total": round(len(crossings) * PRICE_CULVERT, 2),
            }
        )
    cost_ref = round(sum(row["total"] for row in boq), 2)

    # lons/lats are always degrees here, so the tolerance is degrees too.
    line = LineString(np.column_stack([lons, lats]))
    tol = max(mx, my) * 0.35 / 111_320
    simplified = line.simplify(tol, preserve_topology=True)
    coords = [[float(x), float(y)] for x, y in simplified.coords]

    features: list[dict[str, Any]] = [
        {
            "type": "Feature",
            "properties": {
                "kind": "road",
                "length_m": round(length_3d, 1),
                "width_m": width_m,
                "max_grade_pct": round(max_grade, 2),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        }
    ]
    for i, crossing in enumerate(crossings, start=1):
        features.append(
            {
                "type": "Feature",
                "properties": {"kind": "culvert", "index": i, "chainage_m": crossing["chainage_m"]},
                "geometry": {"type": "Point", "coordinates": [crossing["lon"], crossing["lat"]]},
            }
        )

    profile = [
        {"d": round(float(d), 1), "z": round(float(zz), 2)}
        for d, zz in zip(sample_d[:200], sample_z[:200])
    ]

    return {
        "waypoints": waypoints,
        "max_grade_pct": max_grade_pct,
        "width_m": width_m,
        "length_2d_m": round(length_2d, 1),
        "length_3d_m": round(length_3d, 1),
        "mean_grade_pct": round(mean_grade, 2),
        "max_grade_found_pct": round(max_grade, 2),
        "over_grade_length_m": round(over_len, 1),
        "elevation_start": round(float(z[0]), 2),
        "elevation_end": round(float(z[-1]), 2),
        "cut_fill_m3": round(cut_m3, 1),
        "surface_m2": round(surface_m2, 1),
        "culverts": len(crossings),
        "boq": boq,
        "cost_ref_usd": cost_ref,
        "geojson": {"type": "FeatureCollection", "features": features},
        "profile": profile,
        "notes": (
            "Ruta de menor costo sobre pendiente del terreno, penalizando cauces. "
            "Movimiento de tierra = sección balanceada W²·tanθ/8. "
            "Precios de referencia, no cotización ni diseño geométrico vial."
        ),
    }


def _stream_crossings(
    is_stream: np.ndarray,
    lons: np.ndarray,
    lats: np.ndarray,
    dist: np.ndarray,
) -> list[dict[str, float]]:
    """Collapse consecutive stream cells into one culvert per crossing."""
    crossings: list[dict[str, float]] = []
    run: list[int] = []
    for i, flag in enumerate(is_stream):
        if flag:
            run.append(i)
            continue
        if run:
            mid = run[len(run) // 2]
            crossings.append(
                {
                    "lon": float(lons[mid]),
                    "lat": float(lats[mid]),
                    "chainage_m": round(float(dist[mid]), 1),
                }
            )
            run = []
    if run:
        mid = run[len(run) // 2]
        crossings.append(
            {
                "lon": float(lons[mid]),
                "lat": float(lats[mid]),
                "chainage_m": round(float(dist[mid]), 1),
            }
        )
    return crossings
