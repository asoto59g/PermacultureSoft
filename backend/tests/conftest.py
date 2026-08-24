"""DEM sintético y cliente HTTP para las pruebas de la API."""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin, xy

from fastapi.testclient import TestClient

HEIGHT = 80
WIDTH = 80
PIXEL_M = 10.0
# UTM 16N, alrededor del Valle Central.
WEST = 560_000.0
NORTH = 1_104_000.0


def synthetic_dem_bytes() -> bytes:
    rows, cols = np.indices((HEIGHT, WIDTH))
    along = rows.astype(np.float64) * 0.9
    valley = ((cols - (WIDTH - 1) / 2.0) ** 2) * 0.05
    elev = 420.0 - along + valley
    transform = from_origin(WEST, NORTH, PIXEL_M, PIXEL_M)
    buf = io.BytesIO()
    with rasterio.open(
        buf,
        "w",
        driver="GTiff",
        height=HEIGHT,
        width=WIDTH,
        count=1,
        dtype="float32",
        crs="EPSG:32616",
        transform=transform,
        nodata=-9999.0,
    ) as dst:
        dst.write(elev.astype("float32"), 1)
    return buf.getvalue()


def cell_lonlat(row: int, col: int) -> tuple[float, float]:
    transform = from_origin(WEST, NORTH, PIXEL_M, PIXEL_M)
    x, y = xy(transform, row, col)
    lon, lat = Transformer.from_crs("EPSG:32616", "EPSG:4326", always_xy=True).transform(
        x, y
    )
    return float(lon), float(lat)


@pytest.fixture(scope="module")
def api(tmp_path_factory):
    uploads = tmp_path_factory.mktemp("uploads")
    import hydrology
    import main

    old_up = main.UPLOAD_DIR
    old_cache = hydrology.CACHE_DIR
    main.UPLOAD_DIR = uploads
    hydrology.CACHE_DIR = uploads / "_hydro_cache"
    hydrology.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    hydrology._get_hydro_cached.cache_clear()
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        hydrology._get_hydro_cached.cache_clear()
        main.UPLOAD_DIR = old_up
        hydrology.CACHE_DIR = old_cache


@pytest.fixture(scope="module")
def dem(api: TestClient) -> dict[str, Any]:
    response = api.post(
        "/api/geography/upload-dem/",
        files={"file": ("valley.tif", synthetic_dem_bytes(), "image/tiff")},
        data={"interval": "5"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    pour_lon, pour_lat = cell_lonlat(HEIGHT - 4, WIDTH // 2)
    west_lon, mid_lat = cell_lonlat(HEIGHT // 2, 8)
    east_lon, _ = cell_lonlat(HEIGHT // 2, WIDTH - 9)
    kp_lon, kp_lat = cell_lonlat(HEIGHT // 2 + 8, WIDTH // 2)
    bearing_lon, bearing_lat = cell_lonlat(HEIGHT // 2 + 8, WIDTH // 2 + 12)
    return {
        "id": body["dem_id"],
        "bounds": body["bounds"],
        "elevation_min": body["elevation_min"],
        "elevation_max": body["elevation_max"],
        "contours": body["contours_generated"],
        "pour": (pour_lon, pour_lat),
        "road": [(west_lon, mid_lat), (east_lon, mid_lat)],
        "keyline": [(kp_lon, kp_lat), (bearing_lon, bearing_lat)],
    }
