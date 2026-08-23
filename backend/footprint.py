"""Polígono envolvente del DEM, en lon/lat.

Sirve para dos cosas: dibujar el límite real del levantamiento sobre el mapa y
pedir series de lluvia promediadas sobre el área (CHIRPS), en vez de muestrear
un solo punto. Se prefiere el contorno de las celdas con dato; si el ráster está
casi lleno, el rectángulo del extent dice lo mismo con menos vértices.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from rasterio.features import shapes
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

from crsutil import normalize_crs, transformer_to_wgs84

# Un anillo con cientos de vértices no aporta nada a una malla de 5 km.
MAX_RING_VERTICES = 60
FULL_ENOUGH = 0.995


def _largest(geometry: Polygon | MultiPolygon) -> Polygon:
    if isinstance(geometry, MultiPolygon):
        return max(geometry.geoms, key=lambda g: g.area)
    return geometry


def _mask_polygon(valid: np.ndarray, transform: Any) -> Polygon | None:
    try:
        pieces = [
            shape(geom)
            for geom, value in shapes(valid.astype(np.uint8), mask=valid, transform=transform)
            if value == 1
        ]
    except Exception:
        return None
    if not pieces:
        return None
    merged = unary_union(pieces).buffer(0)
    if merged.is_empty:
        return None
    return _largest(merged)


def _simplify(polygon: Polygon, pixel_m: float) -> Polygon:
    """Afloja el contorno hasta que quepa en MAX_RING_VERTICES."""
    result = polygon
    tolerance = max(pixel_m, 1e-9) * 2.0
    for _ in range(8):
        if len(result.exterior.coords) <= MAX_RING_VERTICES:
            return result
        result = _largest(polygon.simplify(tolerance, preserve_topology=True))
        tolerance *= 2.5
    hull = polygon.convex_hull
    return hull if isinstance(hull, Polygon) else result


def dem_footprint(elevation: np.ndarray, transform: Any, raster_crs: Any) -> dict[str, Any]:
    """Devuelve el anillo en lon/lat, su área y de dónde salió."""
    valid = np.isfinite(elevation)
    if not valid.any():
        raise ValueError("El DEM no tiene celdas con elevación.")

    extent = box(
        transform.c,
        transform.f + transform.e * elevation.shape[0],
        transform.c + transform.a * elevation.shape[1],
        transform.f,
    )

    coverage = float(valid.mean())
    polygon: Polygon | None = None
    origin = "extent"
    if coverage < FULL_ENOUGH:
        polygon = _mask_polygon(valid, transform)
        if polygon is not None:
            origin = "mask"
    if polygon is None:
        polygon = extent

    pixel_m = float(max(abs(transform.a), abs(transform.e)))
    polygon = _simplify(polygon, pixel_m)

    crs = normalize_crs(raster_crs)
    projected = crs is not None and crs.is_projected
    # En un CRS proyectado el área sale directa; en grados hay que aproximarla.
    if projected:
        area_ha = polygon.area / 10_000.0
    else:
        lat_mid = polygon.centroid.y
        m_per_deg_lat = 110_574.0
        m_per_deg_lon = 111_320.0 * float(np.cos(np.deg2rad(lat_mid)))
        area_ha = polygon.area * m_per_deg_lat * m_per_deg_lon / 10_000.0

    to_wgs = transformer_to_wgs84(raster_crs)
    if to_wgs is not None:
        polygon = shapely_transform(lambda x, y: to_wgs.transform(x, y), polygon)

    ring = [[round(float(x), 6), round(float(y), 6)] for x, y in polygon.exterior.coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])

    return {
        "geojson": {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {
                        "kind": "dem-footprint",
                        "area_ha": round(area_ha, 2),
                        "source": origin,
                    },
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                }
            ],
        },
        "ring": ring,
        "area_ha": round(area_ha, 2),
        "coverage_pct": round(coverage * 100.0, 1),
        "source": origin,
    }
