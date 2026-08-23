"""Solar altitude/azimuth (NOAA) and DEM shade overlay."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from surfaces import (
    colorize_continuous,
    geotiff_b64,
    hillshade,
    load_dem,
    png_b64,
    resample_dem,
    terrain_derivatives,
)

SHADE_RAMP = [
    (8, 15, 40),
    (40, 60, 90),
    (180, 170, 90),
    (255, 220, 120),
]


def solar_position(lat: float, lon: float, when: datetime) -> dict:
    """Approximate solar azimuth (0=N clockwise) and altitude, site local mean time via lon."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    utc = when.astimezone(timezone.utc)
    yday = utc.timetuple().tm_yday
    hour = utc.hour + utc.minute / 60 + utc.second / 3600
    gamma = 2 * math.pi / 365 * (yday - 1 + (hour - 12) / 24)
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )
    time_offset = eqtime + 4 * lon
    tst = hour * 60 + time_offset
    ha = math.radians(tst / 4 - 180)
    lat_r = math.radians(lat)
    cos_zen = math.sin(lat_r) * math.sin(decl) + math.cos(lat_r) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1.0, min(1.0, cos_zen)))
    alt = 90 - math.degrees(zen)
    az_arg = (math.sin(decl) - math.sin(lat_r) * math.cos(zen)) / (
        math.cos(lat_r) * math.sin(zen) + 1e-12
    )
    az = math.degrees(math.acos(max(-1.0, min(1.0, az_arg))))
    if ha > 0:
        az = 360 - az
    return {
        "azimuth_deg": round(az, 2),
        "altitude_deg": round(alt, 2),
        "declination_deg": round(math.degrees(decl), 2),
    }


def _cast_shadow(
    elev: np.ndarray,
    pixel_m: tuple[float, float],
    azimuth_deg: float,
    altitude_deg: float,
) -> np.ndarray:
    """1 = sunlit, 0 = cast shadow. Simple ray step toward the sun."""
    if altitude_deg <= 0:
        return np.zeros_like(elev, dtype=np.float64)
    mx, my = pixel_m
    az = math.radians(azimuth_deg)
    # Toward the sun (opposite of sun-to-ground shadow direction).
    # Shadow is cast away from sun: step down-sun.
    dx = math.sin(az)  # east
    dy = math.cos(az)  # north; row increases south so row step is -dy
    tan_alt = math.tan(math.radians(altitude_deg))
    step = max(mx, my)
    n_steps = int(min(80, max(elev.shape) * 0.35))
    h, w = elev.shape
    sunlit = np.ones((h, w), dtype=np.float64)
    rows, cols = np.indices((h, w))
    z0 = elev
    for k in range(1, n_steps + 1):
        dist = k * step
        dc = (dx * dist) / mx
        dr = (-dy * dist) / my
        rr = np.clip(np.round(rows + dr).astype(int), 0, h - 1)
        cc = np.clip(np.round(cols + dc).astype(int), 0, w - 1)
        z_ray = z0 + dist * tan_alt
        hit = np.isfinite(elev[rr, cc]) & np.isfinite(z0) & (elev[rr, cc] > z_ray + 0.3)
        sunlit[hit] = 0.0
    sunlit[~np.isfinite(elev)] = np.nan
    return sunlit


def solar_shade_map(
    path: str,
    day_of_year: int = 80,
    hour: float = 10.0,
    resample_pct: float = 40,
    gaussian_sigma: float = 0.0,
) -> dict:
    dem = resample_dem(load_dem(path), resample_pct, gaussian_sigma)
    elev = dem["elevation"]
    b = dem["wgs_bounds"]
    lat = (b["top"] + b["bottom"]) / 2
    lon = (b["left"] + b["right"]) / 2
    from datetime import timedelta

    year = datetime.now(timezone.utc).year
    # hour is civil time at site; convert to UTC via longitude.
    offset_h = lon / 15.0
    when = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=int(day_of_year) - 1)
    when = when + timedelta(hours=float(hour) - offset_h)
    sun = solar_position(lat, lon, when)
    slope_rad, _, aspect, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    hs = hillshade(slope_rad, aspect, sun["azimuth_deg"], max(sun["altitude_deg"], 0.1))
    cast = _cast_shadow(elev, dem["pixel_m"], sun["azimuth_deg"], sun["altitude_deg"])
    score = np.where(np.isfinite(elev), hs * np.clip(cast, 0, 1), np.nan)
    if sun["altitude_deg"] <= 0:
        score = np.where(np.isfinite(elev), 0.0, np.nan)
    rgba = colorize_continuous(score, SHADE_RAMP, 0, 1, opacity=190)
    legend = [
        {"label": "Sombra / noche", "color": "#081028"},
        {"label": "Penumbra", "color": "#b4aa5a"},
        {"label": "Sol directo", "color": "#ffdc78"},
    ]
    return {
        "map_type": "solar",
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "geotiff_b64": geotiff_b64(score, dem),
        "geojson": None,
        "sun": sun,
        "day_of_year": int(day_of_year),
        "hour": float(hour),
        "site": {"lat": lat, "lon": lon},
    }
