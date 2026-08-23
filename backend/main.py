import os
import re
import shutil
import uuid
from pathlib import Path

from projfix import pin_proj_data

# Must run before rasterio/pyproj load their PROJ database.
pin_proj_data()

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402
from rasterio.transform import xy  # noqa: E402
from shapely.geometry import LineString, mapping  # noqa: E402
from skimage import measure  # noqa: E402

from access import design_road  # noqa: E402
from buildings import building_suitability  # noqa: E402
from crsutil import transformer_from_wgs84, transformer_to_wgs84  # noqa: E402
from ecosystems import generate_contour_keylines, generate_keyline_pattern  # noqa: E402
from footprint import dem_footprint  # noqa: E402
from hydrology import (  # noqa: E402
    calculate_gravity_pressure,
    dam_suitability,
    delineate_watershed,
    gravity_pressure_field,
    hydro_surface_map,
)
from pipes import aggregate_boq, design_pipe  # noqa: E402
from solar import solar_shade_map  # noqa: E402
from surfaces import render_surface_map  # noqa: E402

app = FastAPI(
    title="PermacultureSoft API",
    version="0.4.0",
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_stem(filename: str | None) -> str:
    raw = Path(filename or "dem").stem
    cleaned = SAFE_NAME.sub("_", raw).strip("._") or "dem"
    return cleaned[:80]


def _dem_path(dem_id: str) -> Path:
    if not re.fullmatch(r"[0-9a-f-]{36}", dem_id):
        raise HTTPException(status_code=400, detail="Invalid DEM id.")
    path = UPLOAD_DIR / f"{dem_id}.tif"
    if not path.exists():
        raise HTTPException(status_code=404, detail="DEM file not found.")
    return path


def _sample_elevation(src: rasterio.DatasetReader, lon: float, lat: float) -> float:
    x, y = lon, lat
    to_native = transformer_from_wgs84(src.crs)
    if to_native is not None:
        x, y = to_native.transform(lon, lat)

    row, col = src.index(x, y)
    if row < 0 or col < 0 or row >= src.height or col >= src.width:
        raise HTTPException(status_code=400, detail="Point outside DEM extent.")

    value = float(src.read(1, window=rasterio.windows.Window(col, row, 1, 1))[0, 0])
    if src.nodata is not None and value == src.nodata:
        raise HTTPException(status_code=400, detail="No elevation at this point.")
    if np.isnan(value):
        raise HTTPException(status_code=400, detail="No elevation at this point.")
    return value


@app.get("/")
def read_root():
    return {"status": "active", "message": "PermacultureSoft API is running", "version": "0.4.0"}


@app.post("/api/geography/upload-dem")
@app.post("/api/geography/upload-dem/")
async def upload_dem(file: UploadFile = File(...), interval: float = Form(5.0)):
    """
    Sube un DEM, lo guarda con UUID y genera curvas de nivel.
    """
    if interval <= 0:
        raise HTTPException(status_code=400, detail="Interval must be > 0.")

    original = file.filename or ""
    if not original.lower().endswith((".tif", ".tiff")):
        raise HTTPException(status_code=400, detail="Only GeoTIFF (.tif/.tiff) files are accepted.")

    dem_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{dem_id}.tif"

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {exc}") from exc

    try:
        with rasterio.open(file_path) as dataset:
            bounds = dataset.bounds
            try:
                crs = dataset.crs.to_string() if dataset.crs else "Unknown"
            except Exception:
                crs = dataset.crs.to_wkt() if dataset.crs else "Unknown"

            transform = dataset.transform
            elevation = dataset.read(1).astype("float64")
            nodata = dataset.nodata
            if nodata is not None:
                elevation = np.where(elevation == nodata, np.nan, elevation)

            min_elev = float(np.nanmin(elevation))
            max_elev = float(np.nanmax(elevation))
            min_level = np.ceil(min_elev / interval) * interval
            max_level = np.floor(max_elev / interval) * interval
            levels = np.arange(min_level, max_level + interval, interval)
            if len(levels) > 50:
                stride = int(np.ceil(len(levels) / 50))
                levels = levels[::stride]

            features = []
            for level in levels:
                contours = measure.find_contours(elevation, level)
                for contour in contours:
                    if len(contour) > 400:
                        contour = contour[:: max(2, len(contour) // 200)]
                    coords = [xy(transform, row, col) for row, col in contour]
                    if len(coords) >= 2:
                        features.append(
                            {
                                "type": "Feature",
                                "properties": {"elevation": float(level)},
                                "geometry": mapping(LineString(coords)),
                            }
                        )

            left, bottom, right, top = bounds.left, bounds.bottom, bounds.right, bounds.top
            geojson = {"type": "FeatureCollection", "features": features}

            to_wgs = transformer_to_wgs84(dataset.crs)
            if to_wgs is not None and features:
                for feature in features:
                    coords = feature["geometry"]["coordinates"]
                    xs, ys = zip(*coords)
                    nx, ny = to_wgs.transform(xs, ys)
                    feature["geometry"]["coordinates"] = list(zip(nx, ny))
                geojson = {"type": "FeatureCollection", "features": features}

            if to_wgs is not None:
                left, top = to_wgs.transform(bounds.left, bounds.top)
                right, bottom = to_wgs.transform(bounds.right, bounds.bottom)
                left, right = min(left, right), max(left, right)
                bottom, top = min(bottom, top), max(bottom, top)
            elif dataset.crs is None:
                pass
            # Already lon/lat: keep native bounds (GDAL order left,bottom,right,top)

            # El polígono es un extra: si falla, la carga del DEM sigue válida.
            try:
                footprint = dem_footprint(elevation, transform, dataset.crs)
            except Exception:
                footprint = None

        return {
            "status": "success",
            "dem_id": dem_id,
            "original_filename": original,
            "label": _safe_stem(original),
            "crs": str(crs),
            "elevation_min": min_elev,
            "elevation_max": max_elev,
            "interval": interval,
            "bounds": {"left": left, "bottom": bottom, "right": right, "top": top},
            "footprint": footprint,
            "contours_generated": len(features),
            "geojson": geojson,
        }
    except HTTPException:
        if file_path.exists():
            file_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if file_path.exists():
            file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Error processing GeoTIFF: {exc}") from exc


class ElevationRequest(BaseModel):
    dem_id: str
    lon: float
    lat: float


@app.post("/api/geography/elevation")
@app.post("/api/geography/elevation/")
async def get_elevation(req: ElevationRequest):
    path = _dem_path(req.dem_id)
    try:
        with rasterio.open(path) as src:
            elev = _sample_elevation(src, req.lon, req.lat)
            return {"status": "success", "elevation": elev, "lon": req.lon, "lat": req.lat}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class PressureRequest(BaseModel):
    dem_id: str
    lon_source: float
    lat_source: float
    lon_target: float
    lat_target: float


@app.post("/api/water/pressure")
@app.post("/api/water/pressure/")
async def get_gravity_pressure(req: PressureRequest):
    path = _dem_path(req.dem_id)
    try:
        with rasterio.open(path) as src:
            elev_src = _sample_elevation(src, req.lon_source, req.lat_source)
            elev_tgt = _sample_elevation(src, req.lon_target, req.lat_target)
            pressure_bar = calculate_gravity_pressure(elev_src, elev_tgt)
            return {
                "status": "success",
                "pressure_bar": round(pressure_bar, 3),
                "elevation_source": elev_src,
                "elevation_target": elev_tgt,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class WatershedRequest(BaseModel):
    dem_id: str
    lon: float
    lat: float
    resample_pct: float = 50
    gaussian_sigma: float = 0.0


@app.post("/api/water/watershed")
@app.post("/api/water/watershed/")
async def get_watershed(req: WatershedRequest):
    path = _dem_path(req.dem_id)
    try:
        geojson_polygon = delineate_watershed(
            str(path),
            req.lon,
            req.lat,
            req.resample_pct,
            req.gaussian_sigma,
        )
        return {"status": "success", "geojson": geojson_polygon}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class KeylineRequest(BaseModel):
    lon1: float
    lat1: float
    lon2: float
    lat2: float
    offset_distance: float = Field(default=10.0, description="Offset in meters")
    num_lines: int = Field(default=5, ge=1, le=50)
    dem_id: str | None = None
    mode: str = "contour"
    fall_ratio: float = Field(default=0.0025, gt=0, le=0.05)
    resample_pct: float = 50


@app.post("/api/ecosystems/keyline")
@app.post("/api/ecosystems/keyline/")
async def generate_keyline(req: KeylineRequest):
    try:
        if req.mode == "offset" or not req.dem_id:
            geojson = generate_keyline_pattern(
                req.lon1,
                req.lat1,
                req.lon2,
                req.lat2,
                req.offset_distance,
                req.num_lines,
            )
        else:
            path = _dem_path(req.dem_id)
            geojson = generate_contour_keylines(
                str(path),
                req.lon1,
                req.lat1,
                req.lon2,
                req.lat2,
                req.offset_distance,
                req.num_lines,
                req.fall_ratio,
                req.resample_pct,
            )
        return {"status": "success", "geojson": geojson}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class PipeDesignRequest(BaseModel):
    dem_id: str
    vertices: list[list[float]]
    dn_mm: float = 63
    pn_bar: float | None = None
    flow_ls: float = 0.5
    hw_c: float = 150


@app.post("/api/water/pipe")
@app.post("/api/water/pipe/")
async def pipe_design(req: PipeDesignRequest):
    path = _dem_path(req.dem_id)
    try:
        result = design_pipe(
            str(path),
            req.vertices,
            req.dn_mm,
            req.pn_bar,
            req.flow_ls,
            req.hw_c,
        )
        return {"status": "success", **result}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class BoqRequest(BaseModel):
    pipes: list[dict]


@app.post("/api/water/boq")
@app.post("/api/water/boq/")
async def pipe_boq(req: BoqRequest):
    return {"status": "success", **aggregate_boq(req.pipes)}


class RoadRequest(BaseModel):
    dem_id: str
    waypoints: list[list[float]]
    max_grade_pct: float = Field(default=12.0, gt=0, le=45)
    width_m: float = Field(default=4.0, gt=0, le=20)
    resample_pct: float = 50
    gaussian_sigma: float = 0.0


@app.post("/api/access/road")
@app.post("/api/access/road/")
async def access_road(req: RoadRequest):
    path = _dem_path(req.dem_id)
    try:
        result = design_road(
            str(path),
            req.waypoints,
            req.max_grade_pct,
            req.width_m,
            req.resample_pct,
            req.gaussian_sigma,
        )
        return {"status": "success", **result}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class BuildingSiteRequest(BaseModel):
    dem_id: str
    max_slope_pct: float = Field(default=12.0, gt=0, le=60)
    min_pad_m: float = Field(default=20.0, gt=0, le=200)
    resample_pct: float = 50
    gaussian_sigma: float = 0.0
    max_sites: int = Field(default=8, ge=1, le=25)


@app.post("/api/buildings/suitability")
@app.post("/api/buildings/suitability/")
async def buildings_suitability(req: BuildingSiteRequest):
    path = _dem_path(req.dem_id)
    try:
        result = building_suitability(
            str(path),
            req.max_slope_pct,
            req.min_pad_m,
            req.resample_pct,
            req.gaussian_sigma,
            req.max_sites,
        )
        return {"status": "success", **result}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class SolarRequest(BaseModel):
    dem_id: str
    day_of_year: int = Field(default=80, ge=1, le=366)
    hour: float = Field(default=10.0, ge=0, le=24)
    resample_pct: float = 40
    gaussian_sigma: float = 0.0


@app.post("/api/climate/solar")
@app.post("/api/climate/solar/")
async def solar_map(req: SolarRequest):
    path = _dem_path(req.dem_id)
    try:
        result = solar_shade_map(
            str(path),
            req.day_of_year,
            req.hour,
            req.resample_pct,
            req.gaussian_sigma,
        )
        return {"status": "success", **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class SurfaceMapRequest(BaseModel):
    dem_id: str
    map_type: str = "slope"
    resample_pct: float = 50
    gaussian_sigma: float = 0.0


@app.post("/api/surfaces/map")
@app.post("/api/surfaces/map/")
async def surface_map(req: SurfaceMapRequest):
    path = _dem_path(req.dem_id)
    try:
        if req.map_type in ("drainage", "wetness"):
            result = hydro_surface_map(
                str(path),
                req.map_type,
                req.resample_pct,
                req.gaussian_sigma,
            )
        else:
            result = render_surface_map(
                str(path),
                req.map_type,
                req.resample_pct,
                req.gaussian_sigma,
            )
        return {"status": "success", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class PressureFieldRequest(BaseModel):
    dem_id: str
    lon: float
    lat: float
    resample_pct: float = 50
    gaussian_sigma: float = 0.0


@app.post("/api/water/pressure-field")
@app.post("/api/water/pressure-field/")
async def pressure_field(req: PressureFieldRequest):
    path = _dem_path(req.dem_id)
    try:
        result = gravity_pressure_field(
            str(path),
            req.lon,
            req.lat,
            req.resample_pct,
            req.gaussian_sigma,
        )
        return {"status": "success", **result}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class DamSuitabilityRequest(BaseModel):
    dem_id: str
    slope_threshold: float = 8.0
    smallest_basin_ha: float = 8.0
    resample_pct: float = 50
    gaussian_sigma: float = 0.0


@app.post("/api/water/dam-suitability")
@app.post("/api/water/dam-suitability/")
async def dam_suitability_map(req: DamSuitabilityRequest):
    path = _dem_path(req.dem_id)
    try:
        result = dam_suitability(
            str(path),
            req.slope_threshold,
            req.smallest_basin_ha,
            req.resample_pct,
            req.gaussian_sigma,
        )
        return {"status": "success", **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
