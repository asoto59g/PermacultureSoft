import base64
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from skimage.filters import gaussian
from skimage.transform import rescale

from crsutil import transformer_to_wgs84

_MAX_EDGE = 800


def load_dem(path: str) -> dict:
    path = str(Path(path).resolve())
    return _load_dem_cached(path, Path(path).stat().st_mtime)


@lru_cache(maxsize=8)
def _load_dem_cached(path: str, _mtime: float) -> dict:
    with rasterio.open(path) as src:
        elevation = src.read(1).astype(np.float64)
        nodata = src.nodata
        if nodata is not None:
            elevation = np.where(
                np.isclose(elevation, float(nodata), rtol=0, atol=1.0),
                np.nan,
                elevation,
            )
        elevation[~np.isfinite(elevation)] = np.nan
        elevation[np.abs(elevation) > 1e5] = np.nan

        transform = src.transform
        bounds = src.bounds
        crs = src.crs
        dx = abs(transform.a)
        dy = abs(transform.e)
        lat = (bounds.top + bounds.bottom) / 2
        if crs is not None:
            try:
                from pyproj import CRS

                is_geo = CRS.from_user_input(crs).is_geographic
            except Exception:
                is_geo = abs(dx) < 1
        else:
            is_geo = abs(dx) < 1

        if is_geo:
            mx = dx * 111_320 * np.cos(np.deg2rad(lat))
            my = dy * 110_540
        else:
            mx, my = dx, dy

        west, south, east, north = bounds.left, bounds.bottom, bounds.right, bounds.top
        to_wgs = transformer_to_wgs84(crs)
        if to_wgs is not None:
            x0, y0 = to_wgs.transform(bounds.left, bounds.bottom)
            x1, y1 = to_wgs.transform(bounds.right, bounds.top)
            west, east = min(x0, x1), max(x0, x1)
            south, north = min(y0, y1), max(y0, y1)

    return {
        "path": path,
        "elevation": elevation,
        "transform": transform,
        "crs": crs,
        "nodata": nodata,
        "pixel_m": (float(mx), float(my)),
        "wgs_bounds": {
            "left": float(west),
            "bottom": float(south),
            "right": float(east),
            "top": float(north),
        },
    }


def resample_dem(dem: dict, resample_pct: float = 100, gaussian_sigma: float = 0.0) -> dict:
    elev = dem["elevation"]
    transform: Affine = dem["transform"]
    pct = max(10.0, min(100.0, float(resample_pct)))
    scale = pct / 100.0

    h, w = elev.shape
    longest = max(h, w)
    cap = _MAX_EDGE / longest if longest > _MAX_EDGE else 1.0
    scale = min(scale, cap)

    if scale < 0.999:
        elev = rescale(
            elev,
            scale,
            order=1,
            preserve_range=True,
            anti_aliasing=True,
            channel_axis=None,
        ).astype(np.float64)
        transform = transform * Affine.scale(1 / scale, 1 / scale)
        mx, my = dem["pixel_m"]
        pixel_m = (mx / scale, my / scale)
    else:
        pixel_m = dem["pixel_m"]

    if gaussian_sigma and gaussian_sigma > 0:
        mask = ~np.isfinite(elev)
        filled = np.where(mask, np.nanmedian(elev), elev)
        elev = gaussian(filled, sigma=float(gaussian_sigma), preserve_range=True)
        elev[mask] = np.nan

    out = dict(dem)
    out["elevation"] = elev
    out["transform"] = transform
    out["pixel_m"] = pixel_m
    return out


def terrain_derivatives(elevation: np.ndarray, pixel_m: tuple[float, float]):
    mx, my = pixel_m
    gy, gx = np.gradient(elevation, my, mx)
    slope_rad = np.arctan(np.hypot(gx, gy))
    slope_pct = np.tan(slope_rad) * 100.0
    aspect = np.degrees(np.arctan2(-gx, gy))
    aspect = np.where(aspect < 0, aspect + 360.0, aspect)
    return slope_rad, slope_pct, aspect, gx, gy


def hillshade(
    slope_rad: np.ndarray,
    aspect: np.ndarray,
    azimuth_deg: float = 315.0,
    altitude_deg: float = 45.0,
) -> np.ndarray:
    az = np.deg2rad(azimuth_deg)
    alt = np.deg2rad(altitude_deg)
    asp = np.deg2rad(aspect)
    shaded = np.sin(alt) * np.cos(slope_rad) + np.cos(alt) * np.sin(slope_rad) * np.cos(
        az - asp
    )
    return np.clip(shaded, 0, 1)


def colorize_continuous(
    values: np.ndarray,
    ramp: list[tuple[int, int, int]],
    vmin: float | None = None,
    vmax: float | None = None,
    opacity: int = 180,
) -> np.ndarray:
    finite = np.isfinite(values)
    if not finite.any():
        return np.zeros((*values.shape, 4), dtype=np.uint8)
    lo = vmin if vmin is not None else float(np.nanpercentile(values, 2))
    hi = vmax if vmax is not None else float(np.nanpercentile(values, 98))
    if hi <= lo:
        hi = lo + 1e-6
    t = np.zeros_like(values, dtype=np.float64)
    t[finite] = np.clip((values[finite] - lo) / (hi - lo), 0, 1)
    idx = t * (len(ramp) - 1)
    i0 = np.floor(idx).astype(int)
    i0 = np.clip(i0, 0, len(ramp) - 1)
    i1 = np.clip(i0 + 1, 0, len(ramp) - 1)
    f = (idx - i0)[..., None]
    palette = np.array(ramp, dtype=np.float32)
    rgb = palette[i0] * (1 - f) + palette[i1] * f
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.where(finite, opacity, 0).astype(np.uint8)
    return rgba


def colorize_classes(
    classes: np.ndarray,
    colors: list[tuple[int, int, int, int]],
) -> np.ndarray:
    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    for i, color in enumerate(colors):
        mask = classes == i
        if mask.any():
            rgba[mask] = color
    return rgba


def png_b64(rgba: np.ndarray) -> str:
    import imageio.v3 as iio

    encoded = iio.imwrite("<bytes>", rgba, extension=".png")
    return base64.b64encode(encoded).decode("ascii")


SLOPE_RAMP = [
    (46, 163, 72),
    (196, 219, 84),
    (252, 186, 3),
    (232, 93, 4),
    (157, 2, 8),
]
ASPECT_RAMP = [
    (227, 26, 28),
    (253, 174, 97),
    (255, 255, 191),
    (166, 217, 106),
    (26, 150, 65),
    (65, 182, 196),
    (34, 94, 168),
    (123, 50, 148),
    (227, 26, 28),
]
ELEV_RAMP = [
    (8, 104, 66),
    (102, 194, 107),
    (227, 217, 111),
    (191, 129, 45),
    (140, 81, 10),
]


def render_surface_map(
    path: str,
    map_type: str,
    resample_pct: float = 100,
    gaussian_sigma: float = 0.0,
) -> dict:
    dem = resample_dem(load_dem(path), resample_pct, gaussian_sigma)
    elev = dem["elevation"]
    slope_rad, slope_pct, aspect, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    hs = hillshade(slope_rad, aspect)
    export_values = elev

    legend: list[dict] = []
    if map_type == "slope":
        rgba = colorize_continuous(slope_pct, SLOPE_RAMP, 0, float(np.nanpercentile(slope_pct, 98)))
        legend = [
            {"label": "0–5 %", "color": "#2ea348"},
            {"label": "5–15 %", "color": "#c4db54"},
            {"label": "15–30 %", "color": "#fcba03"},
            {"label": ">30 %", "color": "#9d0208"},
        ]
        export_values = slope_pct
    elif map_type == "aspect":
        rgba = colorize_continuous(aspect, ASPECT_RAMP, 0, 360)
        legend = [
            {"label": "N", "color": "#e31a1c"},
            {"label": "E", "color": "#ffffbf"},
            {"label": "S", "color": "#1a9641"},
            {"label": "W", "color": "#225ea8"},
        ]
        export_values = aspect
    elif map_type == "hillshade":
        gray = np.clip(hs * 255, 0, 255)
        rgba = np.zeros((*hs.shape, 4), dtype=np.uint8)
        rgba[..., :3] = gray[..., None]
        rgba[..., 3] = np.where(np.isfinite(elev), 200, 0)
        legend = [{"label": "Hillshade 315° / 45°", "color": "#888888"}]
        export_values = hs
    elif map_type == "elevation":
        rgba = colorize_continuous(elev, ELEV_RAMP)
        legend = [
            {"label": "Bajo", "color": "#086842"},
            {"label": "Alto", "color": "#8c510a"},
        ]
        export_values = elev
    elif map_type in ("drainage", "wetness"):
        # Lazy import: hydrology already imports this module.
        from hydrology import hydro_surface_map

        return hydro_surface_map(path, map_type, resample_pct, gaussian_sigma)
    else:
        raise ValueError(f"Unknown map type: {map_type}")

    return {
        "map_type": map_type,
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "geotiff_b64": geotiff_b64(export_values, dem),
        "geojson": None,
    }


def geotiff_b64(values: np.ndarray, dem: dict, nodata: float = -9999.0) -> str:
    from rasterio.io import MemoryFile

    arr = np.where(np.isfinite(values), values, nodata).astype(np.float32)
    profile = {
        "driver": "GTiff",
        "height": arr.shape[0],
        "width": arr.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": dem["crs"],
        "transform": dem["transform"],
        "nodata": nodata,
        "compress": "lzw",
    }
    with MemoryFile() as mem:
        with mem.open(**profile) as dst:
            dst.write(arr, 1)
        return base64.b64encode(mem.read()).decode("ascii")


def classified_geojson(
    classes: np.ndarray,
    dem: dict,
    labels: list[str],
    max_parts: int = 80,
) -> dict:
    from rasterio.features import shapes
    from shapely.geometry import mapping, shape
    from shapely.ops import transform as shp_transform, unary_union

    from crsutil import transformer_to_wgs84

    to_wgs = transformer_to_wgs84(dem["crs"])
    transform = dem["transform"]
    features = []
    for i, label in enumerate(labels):
        mask = (classes == i).astype(np.uint8)
        if mask.max() == 0:
            continue
        parts = []
        for geom, value in shapes(mask, mask=mask == 1, transform=transform):
            if value != 1:
                continue
            g = shape(geom)
            if g.area <= 0:
                continue
            parts.append(g)
        if not parts:
            continue
        merged = unary_union(parts)
        geoms = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
        geoms.sort(key=lambda g: g.area, reverse=True)
        for g in geoms[: max(1, max_parts // max(len(labels), 1))]:
            g = g.simplify(abs(transform.a) * 1.5, preserve_topology=True)
            if to_wgs is not None:
                g = shp_transform(to_wgs.transform, g)
            features.append(
                {
                    "type": "Feature",
                    "properties": {"class": i, "label": label},
                    "geometry": mapping(g),
                }
            )
    return {"type": "FeatureCollection", "features": features}
