from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.transform import rowcol

# pysheds still calls numpy.in1d, removed in NumPy 2
if not hasattr(np, "in1d"):
    np.in1d = np.isin  # type: ignore[attr-defined]
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform, unary_union

from crsutil import transformer_from_wgs84, transformer_to_wgs84
from surfaces import (
    classified_geojson,
    colorize_classes,
    colorize_continuous,
    geotiff_b64,
    load_dem,
    png_b64,
    resample_dem,
    terrain_derivatives,
)


def calculate_gravity_pressure(elevation_source: float, elevation_target: float) -> float:
    """
    Calcula la presión hidrostática (en bares) por gravedad
    dada la diferencia de elevación (altura o carga hidráulica) en metros.
    1 bar = ~10.197 metros de columna de agua.
    """
    head_m = elevation_source - elevation_target
    if head_m <= 0:
        return 0.0
    return head_m / 10.197


DIRMAP = (64, 128, 1, 2, 4, 8, 16, 32)
CACHE_DIR = Path("uploads") / "_hydro_cache"


def get_hydro(path: str, resample_pct: float = 50, gaussian_sigma: float = 0.0):
    resolved = str(Path(path).resolve())
    mtime = Path(path).stat().st_mtime
    return _get_hydro_cached(resolved, mtime, float(resample_pct), float(gaussian_sigma))


@lru_cache(maxsize=6)
def _get_hydro_cached(path: str, mtime: float, resample_pct: float, gaussian_sigma: float):
    from pysheds.grid import Grid

    dem = resample_dem(load_dem(path), resample_pct, gaussian_sigma)
    elev = dem["elevation"]
    filled = np.where(np.isfinite(elev), elev, -9999.0)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tif_path = CACHE_DIR / f"{Path(path).stem}_{int(resample_pct)}_{gaussian_sigma}_{int(mtime)}.tif"
    if not tif_path.exists():
        profile = {
            "driver": "GTiff",
            "height": filled.shape[0],
            "width": filled.shape[1],
            "count": 1,
            "dtype": "float64",
            "crs": dem["crs"],
            "transform": dem["transform"],
            "nodata": -9999.0,
        }
        with rasterio.open(tif_path, "w", **profile) as dst:
            dst.write(filled, 1)

    grid = Grid.from_raster(str(tif_path))
    raster = grid.read_raster(str(tif_path)).astype(np.float64)
    raster[raster <= -9998] = np.nan
    flooded = grid.fill_pits(raster)
    flooded = grid.fill_depressions(flooded)
    fdir = grid.flowdir(flooded, dirmap=DIRMAP)
    acc = grid.accumulation(fdir, dirmap=DIRMAP)
    return {
        "dem": dem,
        "grid": grid,
        "fdir": fdir,
        "acc": np.asarray(acc, dtype=np.float64),
        "tif_path": str(tif_path),
    }


def delineate_watershed(
    dem_path: str,
    pour_point_lon: float,
    pour_point_lat: float,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
):
    hydro = get_hydro(dem_path, resample_pct, gaussian_sigma)
    dem = hydro["dem"]
    grid = hydro["grid"]
    fdir = hydro["fdir"]

    x, y = pour_point_lon, pour_point_lat
    to_native = transformer_from_wgs84(dem["crs"])
    if to_native is not None:
        x, y = to_native.transform(pour_point_lon, pour_point_lat)

    catch = grid.catchment(x=x, y=y, fdir=fdir, dirmap=DIRMAP, xytype="coordinate")
    catch_u8 = np.ascontiguousarray(np.asarray(catch), dtype=np.uint8)
    if int(catch_u8.max()) == 0:
        raise ValueError("No se pudo delinear la cuenca en este punto.")

    transform = catch.affine if hasattr(catch, "affine") else grid.affine
    parts = [
        shape(geom)
        for geom, value in shapes(catch_u8, mask=catch_u8 == 1, transform=transform)
        if value == 1
    ]
    if not parts:
        raise ValueError("No se pudo delinear la cuenca en este punto.")

    watershed_geom = unary_union(parts)
    if watershed_geom.is_empty:
        raise ValueError("No se pudo delinear la cuenca en este punto.")
    if watershed_geom.geom_type == "MultiPolygon":
        watershed_geom = max(watershed_geom.geoms, key=lambda g: g.area)

    to_wgs = transformer_to_wgs84(dem["crs"])
    if to_wgs is not None:
        watershed_geom = shp_transform(to_wgs.transform, watershed_geom)

    feature = {
        "type": "Feature",
        "properties": {
            "type": "Watershed",
            "pour_point": [pour_point_lon, pour_point_lat],
        },
        "geometry": mapping(watershed_geom),
    }
    return {"type": "FeatureCollection", "features": [feature]}


PRESSURE_BREAKS = [-np.inf, 0.0, 0.5, 1.5, 3.0, 5.0, 8.0, np.inf]
PRESSURE_LABELS = [
    "< 0 bar",
    "0 – 0.5 bar",
    "0.5 – 1.5 bar",
    "1.5 – 3 bar",
    "3 – 5 bar",
    "5 – 8 bar",
    "> 8 bar",
]
PRESSURE_COLORS = [
    (40, 40, 40, 150),
    (255, 220, 50, 160),
    (170, 220, 100, 170),
    (80, 170, 80, 180),
    (30, 120, 50, 180),
    (230, 140, 40, 180),
    (200, 40, 30, 190),
]

DAM_BREAKS = [0.0, 0.25, 0.5, 0.7, 0.85, 1.01]
DAM_LABELS = ["Poor", "Marginal", "Fair", "Good", "Excellent"]
DAM_COLORS = [
    (140, 20, 20, 170),
    (230, 120, 30, 170),
    (240, 210, 50, 170),
    (140, 200, 80, 180),
    (20, 120, 50, 190),
]


def _cell_ha(pixel_m: tuple[float, float]) -> float:
    return (pixel_m[0] * pixel_m[1]) / 10_000.0


def _class_legend(classes: np.ndarray, labels: list[str], colors: list[tuple], cell_ha: float):
    legend = []
    for i, label in enumerate(labels):
        count = int(np.sum(classes == i))
        r, g, b, a = colors[i]
        legend.append(
            {
                "index": i,
                "label": label,
                "color": f"#{r:02x}{g:02x}{b:02x}",
                "area_ha": round(count * cell_ha, 2),
            }
        )
    return legend


DRAINAGE_RAMP = [
    (255, 255, 204),
    (161, 218, 180),
    (65, 182, 196),
    (34, 94, 168),
    (8, 29, 88),
]
WETNESS_RAMP = [
    (255, 245, 208),
    (186, 228, 188),
    (123, 188, 176),
    (67, 147, 195),
    (33, 102, 172),
]


def hydro_surface_map(
    path: str,
    map_type: str,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
) -> dict:
    hydro = get_hydro(path, resample_pct, gaussian_sigma)
    dem = hydro["dem"]
    acc = hydro["acc"]
    elev = dem["elevation"]
    slope_rad, _, _, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    slope_rad = np.clip(slope_rad, 1e-4, None)
    cell_a = dem["pixel_m"][0] * dem["pixel_m"][1]
    acc_area = np.maximum(acc, 1.0) * cell_a

    if map_type == "drainage":
        values = np.log1p(np.maximum(acc, 0))
        rgba = colorize_continuous(values, DRAINAGE_RAMP)
        legend = [
            {"label": "Bajo flujo", "color": "#ffffcc"},
            {"label": "Cauces", "color": "#081d58"},
        ]
    elif map_type == "wetness":
        values = np.log(acc_area / np.tan(slope_rad))
        rgba = colorize_continuous(values, WETNESS_RAMP)
        legend = [
            {"label": "Seco", "color": "#fff5d0"},
            {"label": "Húmedo (TWI)", "color": "#2166ac"},
        ]
    else:
        raise ValueError(f"Unknown hydro map: {map_type}")

    values = np.where(np.isfinite(elev), values, np.nan)
    return {
        "map_type": map_type,
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "geotiff_b64": geotiff_b64(values, dem),
        "geojson": None,
    }


def gravity_pressure_field(
    path: str,
    lon: float,
    lat: float,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
) -> dict:
    dem = resample_dem(load_dem(path), resample_pct, gaussian_sigma)
    elev = dem["elevation"]
    with rasterio.open(path) as src:
        to_native = transformer_from_wgs84(src.crs)
        x, y = lon, lat
        if to_native is not None:
            x, y = to_native.transform(lon, lat)
        row, col = rowcol(dem["transform"], x, y)
        if row < 0 or col < 0 or row >= elev.shape[0] or col >= elev.shape[1]:
            raise ValueError("El punto fuente está fuera del DEM.")
        z_src = float(elev[row, col])
        if not np.isfinite(z_src):
            raise ValueError("No hay elevación en el punto fuente.")

    pressure = (z_src - elev) / 10.197
    classes = np.digitize(pressure, PRESSURE_BREAKS[1:-1], right=False)
    classes = np.where(np.isfinite(pressure), classes, -1).astype(np.int16)
    rgba = colorize_classes(classes, PRESSURE_COLORS)
    legend = _class_legend(classes, PRESSURE_LABELS, PRESSURE_COLORS, _cell_ha(dem["pixel_m"]))
    return {
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "source": {"lon": lon, "lat": lat, "elevation": z_src},
        "geotiff_b64": geotiff_b64(pressure, dem),
        "geojson": classified_geojson(classes, dem, PRESSURE_LABELS),
    }


def dam_suitability(
    path: str,
    slope_threshold: float = 8.0,
    smallest_basin_ha: float = 8.0,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
) -> dict:
    hydro = get_hydro(path, resample_pct, gaussian_sigma)
    dem, acc = hydro["dem"], hydro["acc"]
    elev = dem["elevation"]
    _, slope_pct, _, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    cell_ha = _cell_ha(dem["pixel_m"])
    min_cells = max(1.0, smallest_basin_ha / max(cell_ha, 1e-9))

    try:
        from scipy.ndimage import uniform_filter

        filled = np.where(np.isfinite(elev), elev, np.nanmean(elev))
        rel = elev - uniform_filter(filled, size=15, mode="nearest")
    except ImportError:
        filled = np.where(np.isfinite(elev), elev, np.nanmean(elev))
        rel = elev - filled
    std = float(np.nanstd(rel)) or 1.0
    valley = np.clip(-rel / std, 0, 1)

    acc_log = np.log1p(np.maximum(acc, 0))
    p99 = float(np.nanpercentile(acc_log, 99)) or 1.0
    acc_n = np.clip(acc_log / p99, 0, 1)

    raw = 0.55 * acc_n + 0.45 * valley
    eligible = (
        np.isfinite(elev)
        & np.isfinite(raw)
        & (slope_pct <= slope_threshold)
        & (acc >= min_cells)
    )
    classes = np.zeros(elev.shape, dtype=np.int16)
    if eligible.any():
        qs = np.nanpercentile(raw[eligible], [40, 60, 75, 90])
        ranked = np.digitize(raw, qs, right=False)
        classes = np.where(eligible, ranked, 0).astype(np.int16)
    classes = np.where(np.isfinite(elev), classes, -1).astype(np.int16)
    rgba = colorize_classes(classes, DAM_COLORS)
    legend = _class_legend(classes, DAM_LABELS, DAM_COLORS, cell_ha)
    return {
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "slope_threshold": slope_threshold,
        "smallest_basin_ha": smallest_basin_ha,
        "geotiff_b64": geotiff_b64(classes.astype(np.float32), dem, nodata=-1),
        "geojson": classified_geojson(classes, dem, DAM_LABELS),
    }
