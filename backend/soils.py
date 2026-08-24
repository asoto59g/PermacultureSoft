"""Suelos sobre el DEM: mismas variables que CLIMCOW (OpenLandMap / SoilGrids).

CLIMCOW las lee en Google Earth Engine. Aquí se usan los coberturas públicas
ISRIC SoilGrids 250 m (WCS), equivalentes: arcilla, arena, carbono, pH y agua
a 33 kPa / 1500 kPa. Textura y agua disponible siguen las reglas de
modules/04_suelos.js.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError

import numpy as np
from rasterio.crs import CRS
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, reproject

from surfaces import (
    classified_geojson,
    colorize_classes,
    colorize_continuous,
    geotiff_b64,
    load_dem,
    png_b64,
    resample_dem,
)

WCS_BASE = "https://maps.isric.org/mapserv"
NODATA = -32768
ROOT_DEPTH_MM = 500.0  # CLIMCOW: profundidad efectiva por defecto
OM_FACTOR = 1.724  # MO ≈ C orgánico × 1.724
D_FACTOR = 10.0  # SoilGrids v2: valor mapeado / 10 → unidad de trabajo

# map= / coverage id / conversion already handled by D_FACTOR
_WCS_LAYERS: tuple[tuple[str, str, str], ...] = (
    ("clay", "clay", "clay_0-5cm_mean"),
    ("sand", "sand", "sand_0-5cm_mean"),
    ("soc", "soc", "soc_0-5cm_mean"),
    ("phh2o", "phh2o", "phh2o_0-5cm_mean"),
    ("wv0033_05", "wv0033", "wv0033_0-5cm_mean"),
    ("wv0033_515", "wv0033", "wv0033_5-15cm_mean"),
    ("wv0033_1530", "wv0033", "wv0033_15-30cm_mean"),
    ("wv1500_05", "wv1500", "wv1500_0-5cm_mean"),
    ("wv1500_515", "wv1500", "wv1500_5-15cm_mean"),
    ("wv1500_1530", "wv1500", "wv1500_15-30cm_mean"),
)

TEXTURE_LABELS = ["Arenoso", "Franco", "Arcilloso"]
TEXTURE_COLORS = [(254, 217, 142, 220), (191, 129, 45, 220), (140, 45, 4, 220)]
TEXTURE_HEX = ["#fed98e", "#bf812d", "#8c2d04"]

PH_RAMP = [(165, 0, 38), (252, 141, 89), (255, 255, 191), (145, 207, 96), (0, 104, 55)]
OM_RAMP = [(255, 247, 188), (254, 196, 79), (217, 95, 14), (153, 52, 4)]
AWC_RAMP = [(254, 224, 210), (252, 146, 114), (222, 45, 38), (165, 15, 21)]


def _fetch_wcs(map_name: str, coverage: str, bbox: tuple[float, float, float, float], cols: int, rows: int) -> bytes:
    west, south, east, north = bbox
    query = urlencode(
        {
            "map": f"/map/{map_name}.map",
            "SERVICE": "WCS",
            "VERSION": "1.0.0",
            "REQUEST": "GetCoverage",
            "COVERAGE": coverage,
            "CRS": "EPSG:4326",
            "BBOX": f"{west},{south},{east},{north}",
            "FORMAT": "GEOTIFF_INT16",
            "WIDTH": str(cols),
            "HEIGHT": str(rows),
        }
    )
    req = Request(
        f"{WCS_BASE}?{query}",
        headers={"User-Agent": "PermacultureSoft/0.4 (soils; ISRIC SoilGrids)"},
    )
    try:
        with urlopen(req, timeout=45) as resp:
            payload = resp.read()
    except URLError as exc:
        raise ValueError(
            "No se pudo consultar SoilGrids (ISRIC). Revisa la conexion a internet."
        ) from exc
    if len(payload) < 200 or payload[:3] not in (b"II*", b"MM\x00"):
        snippet = payload[:180].decode("utf-8", errors="replace")
        raise ValueError(f"SoilGrids no devolvió un GeoTIFF ({coverage}): {snippet}")
    return payload


def _wcs_grid_size(west: float, south: float, east: float, north: float) -> tuple[int, int]:
    # ~250 m ≈ 0.00225° en el ecuador; tope para no bajar mapas enormes.
    deg = 0.00225
    cols = int(max(8, min(80, round((east - west) / deg))))
    rows = int(max(8, min(80, round((north - south) / deg))))
    return cols, rows


def _pad_bbox(bounds: dict) -> tuple[float, float, float, float]:
    west, south, east, north = bounds["left"], bounds["bottom"], bounds["right"], bounds["top"]
    pad = 0.004
    if east - west < 0.01:
        mid = (west + east) / 2
        west, east = mid - 0.005, mid + 0.005
    if north - south < 0.01:
        mid = (south + north) / 2
        south, north = mid - 0.005, mid + 0.005
    return west - pad, south - pad, east + pad, north + pad


def _reproject_to_dem(payload: bytes, dem: dict) -> np.ndarray:
    out = np.full(dem["elevation"].shape, np.nan, dtype=np.float64)
    with MemoryFile(payload) as mem, mem.open() as src:
        src_crs = src.crs or CRS.from_epsg(4326)
        arr = src.read(1).astype(np.float64)
        src_nodata = src.nodata if src.nodata is not None else NODATA
        arr = np.where(arr == src_nodata, np.nan, arr)
        reproject(
            source=arr,
            destination=out,
            src_transform=src.transform,
            src_crs=src_crs,
            dst_transform=dem["transform"],
            dst_crs=dem["crs"],
            resampling=Resampling.nearest,
            src_nodata=np.nan,
            dst_nodata=np.nan,
        )
    out[~np.isfinite(dem["elevation"])] = np.nan
    return out


def _weighted_030(v05: np.ndarray, v515: np.ndarray, v1530: np.ndarray) -> np.ndarray:
    stack = np.stack(
        [v05 * 5.0, v515 * 10.0, v1530 * 15.0],
        axis=0,
    )
    weights = np.stack(
        [
            np.where(np.isfinite(v05), 5.0, 0.0),
            np.where(np.isfinite(v515), 10.0, 0.0),
            np.where(np.isfinite(v1530), 15.0, 0.0),
        ],
        axis=0,
    )
    total_w = np.sum(weights, axis=0)
    total_v = np.nansum(stack, axis=0)
    out = np.divide(total_v, total_w, out=np.full_like(total_v, np.nan), where=total_w > 0)
    return out


@lru_cache(maxsize=8)
def _soil_stack(path: str, mtime: float, resample_pct: float) -> dict[str, np.ndarray]:
    del mtime
    dem = resample_dem(load_dem(path), resample_pct, 0.0)
    bbox = _pad_bbox(dem["wgs_bounds"])
    cols, rows = _wcs_grid_size(*bbox)
    layers: dict[str, np.ndarray] = {}
    for key, map_name, coverage in _WCS_LAYERS:
        payload = _fetch_wcs(map_name, coverage, bbox, cols, rows)
        layers[key] = _reproject_to_dem(payload, dem) / D_FACTOR
    return {"dem": dem, **layers}


def _mean(arr: np.ndarray) -> float | None:
    if not np.isfinite(arr).any():
        return None
    return round(float(np.nanmean(arr)), 2)


def soil_properties(path: str, resample_pct: float = 50) -> dict[str, Any]:
    from pathlib import Path

    resolved = str(Path(path).resolve())
    mtime = Path(path).stat().st_mtime
    stack = _soil_stack(resolved, mtime, float(resample_pct))
    dem = stack["dem"]
    clay = stack["clay"]
    sand = stack["sand"]
    silt = np.clip(100.0 - clay - sand, 0, 100)
    soc_pct = stack["soc"] / 10.0  # g/kg → %
    om = soc_pct * OM_FACTOR
    ph = stack["phh2o"]
    cc = _weighted_030(stack["wv0033_05"], stack["wv0033_515"], stack["wv0033_1530"])
    pm = _weighted_030(stack["wv1500_05"], stack["wv1500_515"], stack["wv1500_1530"])
    awc = np.clip((cc - pm) / 100.0 * ROOT_DEPTH_MM, 0, None)

    texture = np.full(clay.shape, 2.0, dtype=np.float64)  # Franco
    texture = np.where((sand > 70) & (clay < 15), 1.0, texture)
    texture = np.where(clay > 40, 3.0, texture)
    texture[~np.isfinite(clay) | ~np.isfinite(sand)] = np.nan

    if not np.isfinite(clay).any():
        raise ValueError(
            "SoilGrids no tiene dato sobre este DEM (costa, laguna o hueco de la malla 250 m)."
        )

    tex_mean = _mean(texture)
    if tex_mean is None:
        texture_label = "Sin dato"
    elif tex_mean < 1.5:
        texture_label = "Arenoso"
    elif tex_mean > 2.5:
        texture_label = "Arcilloso"
    else:
        texture_label = "Franco"

    profile = {
        "clay_pct": _mean(clay),
        "sand_pct": _mean(sand),
        "silt_pct": _mean(silt),
        "om_pct": _mean(om),
        "soc_pct": _mean(soc_pct),
        "ph": _mean(ph),
        "field_capacity_pct": _mean(cc),
        "wilting_point_pct": _mean(pm),
        "awc_mm": _mean(awc),
        "texture": texture_label,
        "root_depth_mm": ROOT_DEPTH_MM,
        "source": "SoilGrids 250 m (ISRIC), mismas variables que CLIMCOW / OpenLandMap",
    }
    return {
        "dem": dem,
        "clay": clay,
        "sand": sand,
        "silt": silt,
        "om": om,
        "ph": ph,
        "awc": awc,
        "texture": texture,
        "profile": profile,
    }


def render_soil_map(
    path: str,
    map_type: str = "texture",
    resample_pct: float = 50,
) -> dict[str, Any]:
    data = soil_properties(path, resample_pct)
    dem = data["dem"]
    px, py = dem["pixel_m"]
    cell_ha = (px * py) / 10_000.0

    if map_type == "texture":
        classes = data["texture"]
        rgba = colorize_classes(
            np.where(np.isfinite(classes), classes - 1, np.nan),
            TEXTURE_COLORS,
        )
        legend = []
        for i, (label, hex_color) in enumerate(zip(TEXTURE_LABELS, TEXTURE_HEX), start=1):
            area = float(np.nansum(classes == i) * cell_ha)
            legend.append(
                {"index": i, "label": label, "color": hex_color, "area_ha": round(area, 2)}
            )
        export = classes
        geojson = classified_geojson(
            np.where(np.isfinite(classes), classes.astype(np.int32) - 1, -1),
            dem,
            TEXTURE_LABELS,
        )
    elif map_type == "ph":
        values = data["ph"]
        finite = values[np.isfinite(values)]
        lo, hi = (float(np.min(finite)), float(np.max(finite))) if finite.size else (4.0, 8.0)
        rgba = colorize_continuous(values, PH_RAMP, max(4.0, lo), min(8.5, hi))
        legend = [
            {"label": "< 5.5 ácido", "color": "#a50026"},
            {"label": "5.5–7.5 adecuado", "color": "#91cf60"},
            {"label": "> 7.5 alcalino", "color": "#006837"},
        ]
        export = values
        geojson = None
    elif map_type == "om":
        values = data["om"]
        finite = values[np.isfinite(values)]
        hi = float(np.nanpercentile(finite, 98)) if finite.size else 8.0
        rgba = colorize_continuous(values, OM_RAMP, 0.0, max(hi, 3.0))
        legend = [
            {"label": "< 2 % baja", "color": "#fff7bc"},
            {"label": "2–5 % media", "color": "#fec44f"},
            {"label": "> 5 % alta", "color": "#993404"},
        ]
        export = values
        geojson = None
    elif map_type == "awc":
        values = data["awc"]
        finite = values[np.isfinite(values)]
        hi = float(np.nanpercentile(finite, 98)) if finite.size else 150.0
        rgba = colorize_continuous(values, AWC_RAMP, 0.0, max(hi, 80.0))
        legend = [
            {"label": "< 50 mm baja", "color": "#fee0d2"},
            {"label": "50–120 mm media", "color": "#fc9272"},
            {"label": "> 120 mm buena", "color": "#a50f15"},
        ]
        export = values
        geojson = None
    else:
        raise ValueError("Mapa de suelo desconocido. Usa texture, ph, om o awc.")

    return {
        "map_type": map_type,
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "geotiff_b64": geotiff_b64(export, dem),
        "geojson": geojson,
        "profile": data["profile"],
        "notes": (
            "Malla 250 m: un predio pequeño puede caer en 1–4 celdas. "
            "No sustituye calicata ni laboratorio. Profundidad de raíz asumida 500 mm "
            "(CLIMCOW) para el agua disponible."
        ),
    }
