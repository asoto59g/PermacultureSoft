"""Curvas de nivel a partir de un ráster de elevación.

El intervalo lo elige el usuario, incluidos 0.25 / 0.50 / 0.75 m. Los niveles
son múltiplos exactos de ese paso (no np.arange con paso flotante). Si el
desnivel obliga a ralear, se salta al siguiente intervalo de la escala de la
interfaz: nunca se multiplica 0.25 × 4 y se entrega 1 m en silencio.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from rasterio.transform import xy
from shapely.geometry import LineString, mapping
from skimage import measure

from crsutil import transformer_to_wgs84

# 0.25 m sobre 300 m de desnivel. Una finca típica cabe; un volcán se ralea.
MAX_CONTOUR_LEVELS = 1200

PREFERRED_INTERVALS = (
    0.25,
    0.5,
    0.75,
    1.0,
    2.0,
    3.0,
    4.0,
    5.0,
    6.0,
    7.0,
    8.0,
    9.0,
    10.0,
)


def interval_decimals(interval: float) -> int:
    if interval >= 1:
        return 2
    return max(2, min(4, int(np.ceil(-np.log10(interval) + 1e-12))))


def contour_levels(zmin: float, zmax: float, interval: float) -> np.ndarray:
    """Múltiplos exactos del intervalo entre zmin y zmax, inclusive."""
    if interval <= 0 or not np.isfinite([zmin, zmax, interval]).all() or zmax < zmin:
        return np.array([], dtype=np.float64)
    places = interval_decimals(interval)
    first = np.ceil(zmin / interval - 1e-12) * interval
    last = np.floor(zmax / interval + 1e-12) * interval
    first = round(float(first), places)
    last = round(float(last), places)
    if last < first:
        return np.array([], dtype=np.float64)
    count = int(np.round((last - first) / interval)) + 1
    levels = first + np.arange(count, dtype=np.float64) * interval
    return np.round(levels, places)


def choose_interval(zmin: float, zmax: float, requested: float) -> tuple[float, int]:
    """(intervalo efectivo, cuántos niveles pedía el intervalo original)."""
    requested = float(requested)
    n_requested = int(contour_levels(zmin, zmax, requested).size)
    if n_requested <= MAX_CONTOUR_LEVELS:
        return requested, n_requested
    relief = float(zmax - zmin)
    for step in PREFERRED_INTERVALS:
        if step + 1e-12 < requested:
            continue
        if int(np.floor(relief / step)) + 2 <= MAX_CONTOUR_LEVELS:
            return step, n_requested
    return PREFERRED_INTERVALS[-1], n_requested


def is_major(elev: float, interval: float) -> bool:
    """Enteros en sub-métrico; cada 5 intervalos cuando el paso ya es de metros."""
    if interval < 1:
        return abs(elev - round(elev)) < 1e-6
    group = interval * 5
    return abs(elev / group - round(elev / group)) < 1e-6


def _features_for_levels(
    elevation: np.ndarray,
    transform: Any,
    levels: np.ndarray,
    interval: float,
) -> list[dict[str, Any]]:
    places = interval_decimals(interval)
    features: list[dict[str, Any]] = []
    for level in levels:
        elev = round(float(level), places)
        major = is_major(elev, interval)
        for contour in measure.find_contours(elevation, float(level)):
            if len(contour) > 400:
                contour = contour[:: max(2, len(contour) // 200)]
            coords = [xy(transform, row, col) for row, col in contour]
            if len(coords) < 2:
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "elevation": elev,
                        "interval": interval,
                        "major": major,
                    },
                    "geometry": mapping(LineString(coords)),
                }
            )
    return features


def _to_wgs(features: list[dict[str, Any]], raster_crs: Any) -> None:
    to_wgs = transformer_to_wgs84(raster_crs)
    if to_wgs is None or not features:
        return
    for feature in features:
        coords = feature["geometry"]["coordinates"]
        if len(coords) < 2:
            continue
        xs, ys = zip(*coords)
        nx, ny = to_wgs.transform(xs, ys)
        feature["geometry"]["coordinates"] = list(zip(nx, ny))


def elevation_contours(
    elevation: np.ndarray,
    transform: Any,
    raster_crs: Any,
    interval: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """GeoJSON en lon/lat y metadatos del intervalo realmente dibujado."""
    valid = elevation[np.isfinite(elevation)]
    if valid.size == 0:
        raise ValueError("El DEM no tiene celdas con elevación.")

    zmin = float(valid.min())
    zmax = float(valid.max())
    effective, n_requested = choose_interval(zmin, zmax, interval)
    levels = contour_levels(zmin, zmax, effective)
    features = _features_for_levels(elevation, transform, levels, effective)
    _to_wgs(features, raster_crs)

    meta = {
        "interval": float(interval),
        "interval_effective": float(effective),
        "levels_requested": n_requested,
        "levels_drawn": int(levels.size),
        "elevation_min": zmin,
        "elevation_max": zmax,
    }
    return {"type": "FeatureCollection", "features": features}, meta
