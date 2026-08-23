import type { FeatureCollection, UploadDemResponse } from "./types";

/** Same-origin via Next rewrite → FastAPI. */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No hay conexión con el API (${detail}). Abre http://127.0.0.1:8000/docs — si no carga, arranca: cd backend; .\\venv\\Scripts\\uvicorn.exe main:app --host 0.0.0.0 --port 8000`
    );
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((d: { msg?: string }) => d.msg || JSON.stringify(d))
        .join("; ");
    }
    if (data?.message) return data.message;
  } catch {
    /* ignore */
  }
  return `HTTP ${response.status}`;
}

export async function rebuildContours(
  demId: string,
  interval: number
): Promise<{
  interval: number;
  interval_effective: number;
  levels_requested: number;
  levels_drawn: number;
  contours_generated: number;
  geojson: FeatureCollection;
}> {
  const response = await apiFetch("/api/geography/contours/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dem_id: demId, interval }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function uploadDem(file: File, interval: number): Promise<UploadDemResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("interval", String(interval));

  const response = await apiFetch("/api/geography/upload-dem/", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function sampleElevation(
  demId: string,
  lon: number,
  lat: number
): Promise<number | null> {
  try {
    const response = await apiFetch("/api/geography/elevation/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dem_id: demId, lon, lat }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.elevation === "number" ? data.elevation : null;
  } catch {
    return null;
  }
}

export async function delineateWatershed(
  demId: string,
  lon: number,
  lat: number,
  resamplePct = 50,
  gaussianSigma = 0
) {
  const response = await apiFetch("/api/water/watershed/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      lon,
      lat,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return data.geojson;
}

export async function computePipePressure(
  demId: string,
  lonSource: number,
  latSource: number,
  lonTarget: number,
  latTarget: number
) {
  const response = await apiFetch("/api/water/pressure/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      lon_source: lonSource,
      lat_source: latSource,
      lon_target: lonTarget,
      lat_target: latTarget,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<{
    pressure_bar: number;
    elevation_source: number;
    elevation_target: number;
  }>;
}

export async function generateKeyline(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  offsetDistance = 10,
  numLines = 5,
  extra?: {
    demId?: string;
    mode?: "contour" | "offset";
    fallRatio?: number;
    resamplePct?: number;
  }
): Promise<FeatureCollection> {
  const response = await apiFetch("/api/ecosystems/keyline/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lon1,
      lat1,
      lon2,
      lat2,
      offset_distance: offsetDistance,
      num_lines: numLines,
      dem_id: extra?.demId,
      mode: extra?.mode ?? "contour",
      fall_ratio: extra?.fallRatio ?? 0.0025,
      resample_pct: extra?.resamplePct ?? 50,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = await response.json();
  return data.geojson;
}

export interface PipeDesignResult {
  vertices: number[][];
  dn_mm: number;
  pn_bar: number;
  pn_recommended: number;
  flow_ls: number;
  length_2d_m: number;
  length_3d_m: number;
  elevation_source: number;
  elevation_target: number;
  pressure_bar: number;
  pressure_max_bar: number;
  headloss_m: number;
  residual_bar: number;
  velocity_ms: number;
  elbows: number;
  boq: {
    item: string;
    qty: number;
    unit: string;
    unit_price: number;
    total: number;
  }[];
  cost_ref_usd: number;
}

export async function designPipe(
  demId: string,
  vertices: number[][],
  dnMm: number,
  flowLs: number,
  pnBar?: number
): Promise<PipeDesignResult> {
  const response = await apiFetch("/api/water/pipe/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      vertices,
      dn_mm: dnMm,
      flow_ls: flowLs,
      pn_bar: pnBar,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export interface RoadDesignResult {
  waypoints: number[][];
  max_grade_pct: number;
  width_m: number;
  length_2d_m: number;
  length_3d_m: number;
  mean_grade_pct: number;
  max_grade_found_pct: number;
  over_grade_length_m: number;
  cut_fill_m3: number;
  surface_m2: number;
  culverts: number;
  boq: {
    item: string;
    qty: number;
    unit: string;
    unit_price: number;
    total: number;
  }[];
  cost_ref_usd: number;
  geojson: FeatureCollection;
  profile: { d: number; z: number }[];
}

export async function designRoad(
  demId: string,
  waypoints: number[][],
  maxGradePct: number,
  widthM: number,
  resamplePct: number,
  gaussianSigma: number
): Promise<RoadDesignResult> {
  const response = await apiFetch("/api/access/road/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      waypoints,
      max_grade_pct: maxGradePct,
      width_m: widthM,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function fetchBuildingSites(
  demId: string,
  maxSlopePct: number,
  minPadM: number,
  resamplePct: number,
  gaussianSigma: number
): Promise<OverlayResponse & { sites?: FeatureCollection }> {
  const response = await apiFetch("/api/buildings/suitability/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      max_slope_pct: maxSlopePct,
      min_pad_m: minPadM,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function fetchSolarMap(
  demId: string,
  dayOfYear: number,
  hour: number,
  resamplePct: number,
  gaussianSigma: number
): Promise<OverlayResponse & { sun?: { azimuth_deg: number; altitude_deg: number } }> {
  const response = await apiFetch("/api/climate/solar/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      day_of_year: dayOfYear,
      hour,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export { API_URL };

export type SurfaceMapType =
  | "slope"
  | "aspect"
  | "hillshade"
  | "elevation"
  | "drainage"
  | "wetness";

export interface OverlayResponse {
  image_png_base64: string;
  bounds: { left: number; bottom: number; right: number; top: number };
  legend: { index?: number; label: string; color: string; area_ha?: number }[];
  source?: { lon: number; lat: number; elevation: number };
  geotiff_b64?: string | null;
  geojson?: FeatureCollection | null;
}

export async function fetchSurfaceMap(
  demId: string,
  mapType: SurfaceMapType,
  resamplePct: number,
  gaussianSigma: number
): Promise<OverlayResponse> {
  const response = await apiFetch("/api/surfaces/map/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      map_type: mapType,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function fetchPressureField(
  demId: string,
  lon: number,
  lat: number,
  resamplePct: number,
  gaussianSigma: number
): Promise<OverlayResponse> {
  const response = await apiFetch("/api/water/pressure-field/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      lon,
      lat,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function fetchDamSuitability(
  demId: string,
  slopeThreshold: number,
  smallestBasinHa: number,
  resamplePct: number,
  gaussianSigma: number
): Promise<OverlayResponse> {
  const response = await apiFetch("/api/water/dam-suitability/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dem_id: demId,
      slope_threshold: slopeThreshold,
      smallest_basin_ha: smallestBasinHa,
      resample_pct: resamplePct,
      gaussian_sigma: gaussianSigma,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
