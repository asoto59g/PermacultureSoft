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

from access import design_road  # noqa: E402
from buildings import building_suitability  # noqa: E402
from contours import elevation_contours  # noqa: E402
from crsutil import transformer_from_wgs84, transformer_to_wgs84  # noqa: E402
from ecosystems import (  # noqa: E402
    generate_contour_keylines,
    generate_keyline_pattern,
    generate_mother_keylines,
)
from keyline_diag import diagnose_and_cut_keylines  # noqa: E402
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
            # Nodata tipo 3.4e38 a veces no coincide bit a bit con el tag.
            elevation = np.where((np.abs(elevation) > 1e5) | ~np.isfinite(elevation), np.nan, elevation)

            geojson, contour_meta = elevation_contours(
                elevation, transform, dataset.crs, interval
            )
            min_elev = contour_meta["elevation_min"]
            max_elev = contour_meta["elevation_max"]
            interval_effective = contour_meta["interval_effective"]
            requested = contour_meta["levels_requested"]
            levels_drawn = contour_meta["levels_drawn"]

            left, bottom, right, top = bounds.left, bounds.bottom, bounds.right, bounds.top
            to_wgs = transformer_to_wgs84(dataset.crs)

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
            except Exception as exc:
                print(f"footprint del DEM no extraído: {exc}")
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
            "interval_effective": round(float(interval_effective), 3),
            "levels_requested": requested,
            "levels_drawn": levels_drawn,
            "bounds": {"left": left, "bottom": bottom, "right": right, "top": top},
            "footprint": footprint,
            "contours_generated": len(geojson["features"]),
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


class ContourRequest(BaseModel):
    dem_id: str
    interval: float = Field(gt=0, le=50)


@app.post("/api/geography/contours")
@app.post("/api/geography/contours/")
async def rebuild_contours(req: ContourRequest):
    """Regenera curvas del DEM ya cargado, sin volver a subir el archivo."""
    path = _dem_path(req.dem_id)
    try:
        with rasterio.open(path) as dataset:
            elevation = dataset.read(1).astype("float64")
            if dataset.nodata is not None:
                elevation = np.where(elevation == dataset.nodata, np.nan, elevation)
            geojson, meta = elevation_contours(
                elevation, dataset.transform, dataset.crs, req.interval
            )
        return {
            "status": "success",
            "dem_id": req.dem_id,
            "interval": req.interval,
            "interval_effective": round(float(meta["interval_effective"]), 3),
            "levels_requested": meta["levels_requested"],
            "levels_drawn": meta["levels_drawn"],
            "contours_generated": len(geojson["features"]),
            "geojson": geojson,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error generating contours: {exc}") from exc


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
    lon2: float | None = None
    lat2: float | None = None
    offset_distance: float = Field(default=10.0, description="Offset in meters")
    num_lines: int = Field(default=5, ge=1, le=50)
    dem_id: str | None = None
    mode: str = "contour"
    fall_ratio: float = Field(default=0.0025, gt=0, le=0.05)
    resample_pct: float = 50
    contour_interval: float = Field(default=0.5, gt=0)
    stake_m: float = Field(default=10.0, ge=0, le=50)


@app.post("/api/ecosystems/keyline")
@app.post("/api/ecosystems/keyline/")
async def generate_keyline(req: KeylineRequest):
    try:
        lon2 = req.lon1 if req.lon2 is None else req.lon2
        lat2 = req.lat1 if req.lat2 is None else req.lat2
        if req.mode == "mother":
            if not req.dem_id:
                raise HTTPException(status_code=400, detail="El modo madre necesita un DEM.")
            geojson = generate_mother_keylines(
                str(_dem_path(req.dem_id)),
                req.lon1,
                req.lat1,
                req.offset_distance,
                req.num_lines,
                req.contour_interval,
                req.resample_pct,
                req.stake_m,
            )
        elif req.mode == "offset" or not req.dem_id:
            geojson = generate_keyline_pattern(
                req.lon1,
                req.lat1,
                lon2,
                lat2,
                req.offset_distance,
                req.num_lines,
            )
            if req.dem_id:
                geojson = diagnose_and_cut_keylines(
                    str(_dem_path(req.dem_id)),
                    geojson,
                    req.resample_pct,
                    stake_m=req.stake_m,
                )
        else:
            path = _dem_path(req.dem_id)
            geojson = generate_contour_keylines(
                str(path),
                req.lon1,
                req.lat1,
                lon2,
                lat2,
                req.offset_distance,
                req.num_lines,
                req.fall_ratio,
                req.resample_pct,
                req.stake_m,
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
