"""Building pad suitability: classified raster + ranked candidate sites."""

from __future__ import annotations

from typing import Any

import numpy as np
from rasterio.transform import xy

from crsutil import transformer_to_wgs84
from hydrology import _cell_ha, _class_legend, get_hydro
from surfaces import (
    classified_geojson,
    colorize_classes,
    geotiff_b64,
    png_b64,
    terrain_derivatives,
)

SITE_LABELS = ["Poor", "Marginal", "Fair", "Good", "Excellent"]
SITE_COLORS = [
    (90, 40, 70, 150),
    (150, 80, 70, 165),
    (205, 145, 70, 175),
    (150, 195, 95, 185),
    (60, 185, 150, 200),
]

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def _aspect_label(deg: float) -> str:
    if not np.isfinite(deg):
        return "—"
    return COMPASS[int((deg % 360) / 45.0 + 0.5) % 8]


def building_suitability(
    path: str,
    max_slope_pct: float = 12.0,
    min_pad_m: float = 20.0,
    resample_pct: float = 50,
    gaussian_sigma: float = 0.0,
    max_sites: int = 8,
) -> dict[str, Any]:
    hydro = get_hydro(path, resample_pct, gaussian_sigma)
    dem = hydro["dem"]
    acc = hydro["acc"]
    elev = dem["elevation"]
    _, slope_pct, aspect, _, _ = terrain_derivatives(elev, dem["pixel_m"])
    mx, my = dem["pixel_m"]
    cell_ha = _cell_ha(dem["pixel_m"])

    from scipy.ndimage import uniform_filter

    filled = np.where(np.isfinite(elev), elev, np.nanmean(elev))

    # Relative elevation: a pad wants to sit on a shoulder, not in a swale.
    rel = filled - uniform_filter(filled, size=15, mode="nearest")
    std = float(np.nanstd(rel)) or 1.0
    relief_score = np.clip(0.5 + rel / (2.0 * std), 0, 1)

    # Dryness: away from concentrated flow.
    acc_log = np.log1p(np.maximum(acc, 0))
    p99 = float(np.nanpercentile(acc_log, 99)) or 1.0
    dry_score = 1.0 - np.clip(acc_log / p99, 0, 1)

    slope_score = np.clip(1.0 - slope_pct / max(max_slope_pct, 0.5), 0, 1)

    # Solar aspect: equator-facing is warmer.
    lat_mid = (dem["wgs_bounds"]["top"] + dem["wgs_bounds"]["bottom"]) / 2.0
    target_az = 180.0 if lat_mid >= 0 else 0.0
    aspect_score = (np.cos(np.deg2rad(aspect - target_az)) + 1.0) / 2.0
    aspect_score = np.where(np.isfinite(aspect_score), aspect_score, 0.5)

    eligible = np.isfinite(elev) & (slope_pct <= max_slope_pct)

    # Fraction of a pad-sized window that is buildable.
    win = max(3, int(round(min_pad_m / max(min(mx, my), 1e-6))))
    pad_frac = uniform_filter(eligible.astype(np.float64), size=win, mode="nearest")

    score = (
        0.35 * slope_score
        + 0.20 * dry_score
        + 0.15 * relief_score
        + 0.15 * aspect_score
        + 0.15 * pad_frac
    )
    score = np.where(eligible, score, np.nan)

    classes = np.zeros(elev.shape, dtype=np.int16)
    usable = eligible & np.isfinite(score)
    if usable.any():
        qs = np.nanpercentile(score[usable], [40, 60, 75, 90])
        ranked = np.digitize(score, qs, right=False)
        classes = np.where(usable, ranked, 0).astype(np.int16)
    classes = np.where(np.isfinite(elev), classes, -1).astype(np.int16)

    rgba = colorize_classes(classes, SITE_COLORS)
    legend = _class_legend(classes, SITE_LABELS, SITE_COLORS, cell_ha)

    sites = _pick_sites(
        score,
        classes,
        pad_frac,
        slope_pct,
        aspect,
        elev,
        dem,
        win,
        cell_ha,
        max_sites,
    )

    return {
        "image_png_base64": png_b64(rgba),
        "bounds": dem["wgs_bounds"],
        "legend": legend,
        "max_slope_pct": max_slope_pct,
        "min_pad_m": min_pad_m,
        "geotiff_b64": geotiff_b64(classes.astype(np.float32), dem, nodata=-1),
        "geojson": classified_geojson(classes, dem, SITE_LABELS),
        "sites": sites,
        "notes": (
            "Aptitud = 0.35 pendiente + 0.20 sequedad + 0.15 posición relativa "
            "+ 0.15 orientación solar + 0.15 plataforma disponible. "
            "Cribado preliminar, no implantación arquitectónica ni estudio de suelos."
        ),
    }


def _pick_sites(
    score: np.ndarray,
    classes: np.ndarray,
    pad_frac: np.ndarray,
    slope_pct: np.ndarray,
    aspect: np.ndarray,
    elev: np.ndarray,
    dem: dict,
    win: int,
    cell_ha: float,
    max_sites: int,
) -> dict[str, Any]:
    candidate = np.isfinite(score) & (classes >= 3) & (pad_frac >= 0.8)
    features: list[dict[str, Any]] = []
    if not candidate.any():
        return {"type": "FeatureCollection", "features": features}

    flat = np.where(candidate, score, -np.inf).ravel()
    # Only the strongest cells can win; keeps the greedy scan bounded.
    top_n = min(flat.size, 20_000)
    order = np.argpartition(flat, -top_n)[-top_n:]
    order = order[np.argsort(flat[order])[::-1]]

    to_wgs = transformer_to_wgs84(dem["crs"])
    width = score.shape[1]
    # Keep candidates several pad-widths apart so they read as distinct sites.
    min_sep = max(win * 3.0, 5.0)
    chosen: list[tuple[int, int]] = []

    for idx in order:
        if len(chosen) >= max_sites:
            break
        if not np.isfinite(flat[idx]):
            break
        r, c = divmod(int(idx), width)
        if any((r - pr) ** 2 + (c - pc) ** 2 < min_sep**2 for pr, pc in chosen):
            continue
        chosen.append((r, c))

        x, y = xy(dem["transform"], r, c)
        lon, lat = (x, y) if to_wgs is None else to_wgs.transform(x, y)
        pad_ha = float(pad_frac[r, c]) * (win**2) * cell_ha
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "building-site",
                    "rank": len(chosen),
                    "score": round(float(score[r, c]), 3),
                    "elevation_m": round(float(elev[r, c]), 2),
                    "slope_pct": round(float(slope_pct[r, c]), 2),
                    "aspect": _aspect_label(float(aspect[r, c])),
                    "pad_ha": round(pad_ha, 3),
                },
                "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            }
        )

    return {"type": "FeatureCollection", "features": features}
