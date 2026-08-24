"""Pruebas HTTP del backend: DEM sintético, cuenca, keyline, camino, suelos, cercas e insolación anual.

Desde backend/:

    python -m pip install -r requirements-dev.txt
    python -m pytest tests -q
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient


def test_root(api: TestClient) -> None:
    response = api.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active"
    assert body["version"] == "0.4.0"


def test_upload_rejects_non_tiff(api: TestClient) -> None:
    response = api.post(
        "/api/geography/upload-dem/",
        files={"file": ("nota.txt", b"no es un raster", "text/plain")},
        data={"interval": "5"},
    )
    assert response.status_code == 400


def test_upload_synthetic_dem(dem: dict[str, Any]) -> None:
    assert dem["elevation_min"] < dem["elevation_max"]
    assert dem["contours"] > 0
    b = dem["bounds"]
    assert b["left"] < b["right"]
    assert b["bottom"] < b["top"]


def test_watershed(api: TestClient, dem: dict[str, Any]) -> None:
    lon, lat = dem["pour"]
    response = api.post(
        "/api/water/watershed/",
        json={"dem_id": dem["id"], "lon": lon, "lat": lat, "resample_pct": 100},
    )
    assert response.status_code == 200, response.text
    geo = response.json()["geojson"]
    assert geo["type"] == "FeatureCollection"
    assert geo["features"]
    geom = geo["features"][0]["geometry"]["type"]
    assert geom in {"Polygon", "MultiPolygon"}


def test_keyline_offset_runs_icl(api: TestClient, dem: dict[str, Any]) -> None:
    (lon1, lat1), (lon2, lat2) = dem["keyline"]
    response = api.post(
        "/api/ecosystems/keyline/",
        json={
            "dem_id": dem["id"],
            "lon1": lon1,
            "lat1": lat1,
            "lon2": lon2,
            "lat2": lat2,
            "mode": "offset",
            "offset_distance": 10,
            "num_lines": 3,
            "resample_pct": 100,
            "stake_m": 10,
        },
    )
    assert response.status_code == 200, response.text
    geo = response.json()["geojson"]
    assert geo["type"] == "FeatureCollection"
    assert geo["features"]
    kinds = {f.get("properties", {}).get("type") for f in geo["features"]}
    # diagnose_and_cut_keylines etiqueta Keyline / GuideLine / Stakeout.
    assert "Keyline" in kinds or "GuideLine" in kinds


def test_road_reports_grade(api: TestClient, dem: dict[str, Any]) -> None:
    (lon1, lat1), (lon2, lat2) = dem["road"]
    response = api.post(
        "/api/access/road/",
        json={
            "dem_id": dem["id"],
            "waypoints": [[lon1, lat1], [lon2, lat2]],
            "max_grade_pct": 12,
            "width_m": 4,
            "resample_pct": 100,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["length_3d_m"] > 0
    assert "over_grade_length_m" in body
    assert "max_grade_found_pct" in body
    kinds = {f["properties"]["kind"] for f in body["geojson"]["features"]}
    assert "road" in kinds


def test_road_needs_two_points(api: TestClient, dem: dict[str, Any]) -> None:
    (lon1, lat1), _ = dem["road"]
    response = api.post(
        "/api/access/road/",
        json={"dem_id": dem["id"], "waypoints": [[lon1, lat1]]},
    )
    assert response.status_code == 400


def _fake_soilgrids_tif(coverage: str, bbox: tuple[float, float, float, float], cols: int, rows: int) -> bytes:
    """GeoTIFF INT16 como el WCS de ISRIC, sin red. Valores /10 = unidades de trabajo."""
    import rasterio
    from rasterio.transform import from_bounds

    west, south, east, north = bbox
    raw = {
        "clay_0-5cm_mean": 250,
        "sand_0-5cm_mean": 400,
        "soc_0-5cm_mean": 200,
        "phh2o_0-5cm_mean": 62,
        "wv0033_0-5cm_mean": 300,
        "wv0033_5-15cm_mean": 300,
        "wv0033_15-30cm_mean": 300,
        "wv1500_0-5cm_mean": 150,
        "wv1500_5-15cm_mean": 150,
        "wv1500_15-30cm_mean": 150,
    }[coverage]
    buf = io.BytesIO()
    transform = from_bounds(west, south, east, north, cols, rows)
    with rasterio.open(
        buf,
        "w",
        driver="GTiff",
        height=rows,
        width=cols,
        count=1,
        dtype="int16",
        crs="EPSG:4326",
        transform=transform,
        nodata=-32768,
    ) as dst:
        dst.write(np.full((rows, cols), raw, dtype="int16"), 1)
    return buf.getvalue()


def test_soil_texture_map(api: TestClient, dem: dict[str, Any], monkeypatch) -> None:
    import soils

    soils._soil_stack.cache_clear()

    def fake_wcs(map_name: str, coverage: str, bbox, cols: int, rows: int) -> bytes:
        del map_name
        return _fake_soilgrids_tif(coverage, bbox, cols, rows)

    monkeypatch.setattr(soils, "_fetch_wcs", fake_wcs)
    response = api.post(
        "/api/soils/map/",
        json={"dem_id": dem["id"], "map_type": "texture", "resample_pct": 50},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["image_png_base64"]
    profile = body["profile"]
    assert profile["texture"] == "Franco"
    assert profile["clay_pct"] == 25.0
    assert profile["sand_pct"] == 40.0
    assert abs(profile["om_pct"] - 3.45) < 0.05
    assert profile["ph"] == 6.2
    assert abs(profile["awc_mm"] - 75.0) < 0.5
    labels = {f["properties"]["label"] for f in body["geojson"]["features"]}
    assert "Franco" in labels
    soils._soil_stack.cache_clear()


def test_soil_rejects_unknown_map(api: TestClient, dem: dict[str, Any], monkeypatch) -> None:
    import soils

    soils._soil_stack.cache_clear()
    monkeypatch.setattr(
        soils,
        "_fetch_wcs",
        lambda map_name, coverage, bbox, cols, rows: _fake_soilgrids_tif(
            coverage, bbox, cols, rows
        ),
    )
    response = api.post(
        "/api/soils/map/",
        json={"dem_id": dem["id"], "map_type": "nitrogen"},
    )
    assert response.status_code == 400
    soils._soil_stack.cache_clear()


def test_living_fence_plants(api: TestClient, dem: dict[str, Any]) -> None:
    (lon1, lat1), (lon2, lat2) = dem["road"]
    response = api.post(
        "/api/fences/living/",
        json={
            "dem_id": dem["id"],
            "vertices": [[lon1, lat1], [lon2, lat2]],
            "species": "gliricidia",
            "spacing_m": 2.0,
            "rows": 1,
            "purpose": "lindero",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["length_2d_m"] > 10
    assert body["plant_count"] >= 2
    kinds = {f["properties"].get("kind") for f in body["geojson"]["features"]}
    assert "living-fence" in kinds
    assert "plant" in kinds
    assert body["boq"]


def test_living_fence_needs_two_points(api: TestClient, dem: dict[str, Any]) -> None:
    (lon1, lat1), _ = dem["road"]
    response = api.post(
        "/api/fences/living/",
        json={"dem_id": dem["id"], "vertices": [[lon1, lat1]]},
    )
    assert response.status_code == 400


def test_solar_annual_map(api: TestClient, dem: dict[str, Any]) -> None:
    response = api.post(
        "/api/climate/solar-annual/",
        json={
            "dem_id": dem["id"],
            "resample_pct": 50,
            "gaussian_sigma": 0,
            "hour_step": 2.0,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert body["image_png_base64"]
    annual = body["annual"]
    assert annual["mean_kwh_m2"] > 0
    assert annual["max_kwh_m2"] >= annual["min_kwh_m2"]
    assert annual["days_sampled"] == 12
    assert annual["hours_sampled"] > 0


def test_sample_dem_uploads(api: TestClient) -> None:
    sample = Path(__file__).resolve().parents[2] / "samples" / "valle_ejemplo.tif"
    assert sample.is_file(), "Falta samples/valle_ejemplo.tif (scripts/make_sample_dem.py)"
    response = api.post(
        "/api/geography/upload-dem/",
        files={"file": ("valle_ejemplo.tif", sample.read_bytes(), "image/tiff")},
        data={"interval": "5"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "success"
    assert "5367" in str(body["crs"])
    assert body["elevation_max"] > body["elevation_min"]
    assert body["footprint"]["area_ha"] > 100
