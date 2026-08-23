import math

import numpy as np
from pyproj import Transformer
from rasterio.transform import rowcol
from shapely.geometry import LineString, mapping
from shapely.ops import transform

from crsutil import transformer_from_wgs84, transformer_to_wgs84
from surfaces import load_dem, resample_dem, terrain_derivatives


def _utm_epsg(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def generate_keyline_pattern(
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    offset_distance: float = 10.0,
    num_lines: int = 5,
):
    """
    Genera líneas paralelas a una guía.
    offset_distance está en metros; se proyecta a UTM local.
    """
    epsg = _utm_epsg((lon1 + lon2) / 2, (lat1 + lat2) / 2)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform

    guide_wgs = LineString([(lon1, lat1), (lon2, lat2)])
    guide_utm = transform(to_utm, guide_wgs)

    features = [
        {
            "type": "Feature",
            "properties": {"type": "GuideLine", "index": 0, "offset_m": 0},
            "geometry": mapping(guide_wgs),
        }
    ]

    for i in range(1, num_lines + 1):
        dist = offset_distance * i
        for side in ("left", "right"):
            offset_line = guide_utm.parallel_offset(dist, side, join_style=2)
            if offset_line.is_empty:
                continue
            geoms = (
                list(offset_line.geoms)
                if offset_line.geom_type == "MultiLineString"
                else [offset_line]
            )
            for geom in geoms:
                features.append(
                    {
                        "type": "Feature",
                        "properties": {
                            "type": "Keyline",
                            "index": i,
                            "side": side,
                            "offset_m": dist,
                        },
                        "geometry": mapping(transform(to_wgs, geom)),
                    }
                )

    return {"type": "FeatureCollection", "features": features}


def generate_contour_keylines(
    path: str,
    lon1: float,
    lat1: float,
    lon2: float,
    lat2: float,
    spacing_m: float = 10.0,
    num_lines: int = 5,
    fall_ratio: float = 1 / 400,
    resample_pct: float = 50,
) -> dict:
    """
    Yeomans-style cultivation lines: walk nearly on contour in the guide
    direction, with a slight downhill grade (default 1:400).
    """
    dem = resample_dem(load_dem(path), resample_pct, 0.0)
    elev = dem["elevation"]
    _, _, aspect, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    transform = dem["transform"]
    to_native = transformer_from_wgs84(dem["crs"])
    to_wgs = transformer_to_wgs84(dem["crs"])
    mx, my = dem["pixel_m"]
    step_m = max(8.0, max(mx, my) * 1.2)
    h, w = elev.shape

    def to_xy(lon: float, lat: float) -> tuple[float, float]:
        if to_native is None:
            return lon, lat
        return to_native.transform(lon, lat)

    def to_ll(x: float, y: float) -> tuple[float, float]:
        if to_wgs is None:
            return x, y
        return to_wgs.transform(x, y)

    x1, y1 = to_xy(lon1, lat1)
    x2, y2 = to_xy(lon2, lat2)
    ge = x2 - x1
    gn = y2 - y1
    gnorm = math.hypot(ge, gn) or 1.0
    ge, gn = ge / gnorm, gn / gnorm

    # Geographic: treat native x as easting, y as northing. If CRS is lon/lat,
    # convert metre steps into degrees using pixel_m vs transform.
    is_geo = abs(transform.a) < 1

    def step_xy(x: float, y: float, east_m: float, north_m: float) -> tuple[float, float]:
        if is_geo:
            lat = y if to_native is None else to_ll(x, y)[1]
            return x + east_m / (111_320 * max(0.2, math.cos(math.radians(lat)))), y + north_m / 110_540
        return x + east_m, y + north_m

    def sample(x: float, y: float):
        r, c = rowcol(transform, x, y)
        if r < 0 or c < 0 or r >= h or c >= w:
            return None
        z = elev[r, c]
        if not np.isfinite(z):
            return None
        return int(r), int(c), float(z), float(aspect[r, c])

    def walk(x0: float, y0: float, max_len: float) -> list[tuple[float, float]]:
        pts_xy = [(x0, y0)]
        x, y = x0, y0
        travelled = 0.0
        for _ in range(4500):
            hit = sample(x, y)
            if hit is None:
                break
            _r, _c, _z, asp = hit
            down_e = math.sin(math.radians(asp))
            down_n = math.cos(math.radians(asp))
            c_e, c_n = -down_n, down_e
            if c_e * ge + c_n * gn < 0:
                c_e, c_n = -c_e, -c_n
            e = c_e + fall_ratio * down_e
            n = c_n + fall_ratio * down_n
            nrm = math.hypot(e, n) or 1.0
            e, n = e / nrm, n / nrm
            nx, ny = step_xy(x, y, e * step_m, n * step_m)
            if sample(nx, ny) is None:
                break
            travelled += step_m
            x, y = nx, ny
            pts_xy.append((x, y))
            if travelled >= max_len:
                break
        return pts_xy

    start = sample(x1, y1)
    if start is None:
        raise ValueError("El primer punto está fuera del DEM.")
    _r, _c, _z, asp0 = start
    down_e = math.sin(math.radians(asp0))
    down_n = math.cos(math.radians(asp0))
    guide_len = max(80.0, math.hypot(x2 - x1, y2 - y1) * (1 if not is_geo else 110_000) * 1.4)
    if is_geo:
        guide_len = max(120.0, gnorm * 111_000 * 1.3)

    features = [
        {
            "type": "Feature",
            "properties": {"type": "GuideLine", "index": 0, "offset_m": 0},
            "geometry": mapping(LineString([(lon1, lat1), (lon2, lat2)])),
        }
    ]

    for i in range(num_lines):
        ox, oy = step_xy(x1, y1, down_e * spacing_m * i, down_n * spacing_m * i)
        if sample(ox, oy) is None:
            ox, oy = x1, y1
        pts = walk(ox, oy, guide_len)
        if len(pts) < 2:
            continue
        coords = [list(to_ll(px, py)) for px, py in pts]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "type": "Keyline",
                    "index": i + 1,
                    "offset_m": round(spacing_m * i, 1),
                    "fall": f"1:{int(round(1 / fall_ratio)) if fall_ratio else 0}",
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            }
        )

    if len(features) < 2:
        raise ValueError("No se pudo trazar keyline sobre el DEM (prueba otro rumbo).")
    return {"type": "FeatureCollection", "features": features}
