import { NextResponse } from "next/server";

import { fetchChirpsDaily, type ChirpsSeries } from "@/lib/chirps";
import {
  annualFromDaily,
  climatologyAnnual,
  climatologyDaily,
  climatologyMonthly,
  daysInYear,
  monthlyFromDaily,
  type AnnualRecord,
  type ClimateResponse,
  type DailyRecord,
  type SourceStatus,
} from "@/lib/climate";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/** Diez años de CHIRPS pueden pasar de 30 s si ClimateSERV está cargado. */
export const maxDuration = 120;

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 20_000;
const FORECAST_DAYS = 10;
/** El reanálisis va ~7 días atrás; el pronóstico cubre el hueco con past_days. */
const BRIDGE_DAYS = 21;
/** Presupuesto para CHIRPS. Si se pasa, la lluvia se queda en ERA5. */
const CHIRPS_BUDGET_MS = 90_000;
/** IFS 0.25°: es el único ECMWF de Open-Meteo con las siete diarias. */
const FORECAST_MODEL = "ecmwf_ifs025";
const FORECAST_MODEL_LABEL = "ECMWF IFS 0.25°";

const DAILY_VARS = [
  "temperature_2m_mean",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "shortwave_radiation_sum",
  "et0_fao_evapotranspiration",
  "relative_humidity_2m_mean",
].join(",");

interface OpenMeteoDaily {
  time?: string[];
  temperature_2m_mean?: (number | null)[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_sum?: (number | null)[];
  shortwave_radiation_sum?: (number | null)[];
  et0_fao_evapotranspiration?: (number | null)[];
  relative_humidity_2m_mean?: (number | null)[];
}

interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  daily?: OpenMeteoDaily;
  error?: boolean;
  reason?: string;
}

async function fetchOpenMeteo(url: string): Promise<OpenMeteoResponse> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const payload = (await response.json()) as OpenMeteoResponse;
  if (!response.ok || payload.error) {
    throw new Error(payload.reason || `Open-Meteo respondió ${response.status}`);
  }
  if (!payload.daily?.time?.length) {
    throw new Error("Open-Meteo no devolvió serie diaria");
  }
  return payload;
}

function cell(values: (number | null)[] | undefined, index: number): number | null {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Convierte la respuesta cruda en registros. Con keepEmpty conserva posiciones. */
function parseDaily(payload: OpenMeteoResponse, keepEmpty = false): DailyRecord[] {
  const daily = payload.daily;
  const times = daily?.time ?? [];
  const out: DailyRecord[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const date = times[i];
    const [year, month, day] = date.split("-").map(Number);
    if (!year || !month || !day) continue;
    const record: DailyRecord = {
      date,
      dayOfYear: dayOfYear(year, month, day),
      month,
      day,
      tMean: cell(daily?.temperature_2m_mean, i),
      tMax: cell(daily?.temperature_2m_max, i),
      tMin: cell(daily?.temperature_2m_min, i),
      precipMm: cell(daily?.precipitation_sum, i),
      et0Mm: cell(daily?.et0_fao_evapotranspiration, i),
      radiationMj: cell(daily?.shortwave_radiation_sum, i),
      rhPct: cell(daily?.relative_humidity_2m_mean, i),
    };
    const empty =
      record.tMean === null &&
      record.precipMm === null &&
      record.et0Mm === null &&
      record.radiationMj === null &&
      record.rhPct === null;
    if (keepEmpty || !empty) out.push(record);
  }
  return out;
}

function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.round((current - start) / 86_400_000) + 1;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function archiveUrl(lat: number, lon: number, start: string, end: string): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    start_date: start,
    end_date: end,
    daily: DAILY_VARS,
    timezone: "auto",
    models: "era5_seamless",
  });
  return `${ARCHIVE_URL}?${params}`;
}

function forecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    daily: DAILY_VARS,
    timezone: "auto",
    past_days: BRIDGE_DAYS.toString(),
    forecast_days: FORECAST_DAYS.toString(),
    models: FORECAST_MODEL,
  });
  return `${FORECAST_URL}?${params}`;
}

function validVertex(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** "lon,lat;lon,lat;…" tal como lo manda el panel desde el límite del DEM. */
function parseRing(text: string | null): number[][] | null {
  if (!text) return null;
  const ring: number[][] = [];
  for (const pair of text.split(";")) {
    const [lonText, latText] = pair.split(",");
    const lon = Number(lonText);
    const lat = Number(latText);
    if (!validVertex(lon, lat)) return null;
    ring.push([lon, lat]);
  }
  return ring.length >= 3 ? ring : null;
}

/** Anillo [lon, lat][] del POST; ignora un par [lat, lon] mal etiquetado. */
function parseRingJson(value: unknown): number[][] | null {
  if (typeof value === "string") return parseRing(value);
  if (!Array.isArray(value) || value.length < 3) return null;
  const ring: number[][] = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!validVertex(lon, lat)) return null;
    ring.push([lon, lat]);
  }
  return ring;
}

/** Una celda CHIRPS (~0.05°) alrededor del punto, si no hay polígono del DEM. */
function boxAround(lon: number, lat: number, halfDeg = 0.025): number[][] {
  return [
    [lon - halfDeg, lat - halfDeg],
    [lon + halfDeg, lat - halfDeg],
    [lon + halfDeg, lat + halfDeg],
    [lon - halfDeg, lat + halfDeg],
    [lon - halfDeg, lat - halfDeg],
  ];
}

/** Sustituye la lluvia de cada día por CHIRPS donde exista. Devuelve cuántos cambió. */
function applyChirps(days: DailyRecord[], chirps: ChirpsSeries): number {
  let replaced = 0;
  for (const day of days) {
    const value = chirps.byDate.get(day.date);
    if (value === undefined) continue;
    day.precipMm = value;
    replaced += 1;
  }
  return replaced;
}

function reason(result: PromiseRejectedResult): string {
  const error = result.reason;
  return error instanceof Error ? error.message : String(error);
}

async function buildSeries(lat: number, lon: number, requestedYears: number, demRing: number[][] | null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json(
      { error: "Coordenadas inválidas. Se esperan lat y lon en grados decimales." },
      { status: 400 }
    );
  }
  const years = Math.min(30, Math.max(3, Math.round(requestedYears) || 10));

  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const lastComplete = currentYear - 1;
  const firstYear = lastComplete - years + 1;
  const climStart = `${firstYear}-01-01`;
  const climEnd = `${lastComplete}-12-31`;
  const yearStart = `${currentYear}-01-01`;

  const usedDemPolygon = Boolean(demRing);
  const ring = demRing ?? boxAround(lon, lat);

  // Un solo trabajo de CHIRPS cubre climatología y año en curso: dos trabajos
  // cuestan casi lo mismo que uno largo y duplican el riesgo de agotar el tiempo.
  const [climResult, currentResult, forecastResult, chirpsResult] = await Promise.allSettled([
    fetchOpenMeteo(archiveUrl(lat, lon, climStart, climEnd)),
    fetchOpenMeteo(archiveUrl(lat, lon, yearStart, isoDate(today))),
    fetchOpenMeteo(forecastUrl(lat, lon)),
    fetchChirpsDaily(ring, climStart, isoDate(today), CHIRPS_BUDGET_MS),
  ]);

  const sources: SourceStatus[] = [];
  const meta =
    climResult.status === "fulfilled"
      ? climResult.value
      : currentResult.status === "fulfilled"
        ? currentResult.value
        : forecastResult.status === "fulfilled"
          ? forecastResult.value
          : null;

  if (!meta) {
    return NextResponse.json(
      {
        error: "Ninguna fuente climática respondió.",
        detail: [climResult, currentResult, forecastResult]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map(reason),
      },
      { status: 502 }
    );
  }

  // La serie del pronóstico trae past_days y luego forecast_days a partir de hoy
  // en la zona del sitio. Se parte por posición: comparar contra una fecha UTC
  // pierde un día cuando el sitio va detrás de UTC.
  const bridge: DailyRecord[] = [];
  let forecast: ClimateResponse["forecast"] = null;
  if (forecastResult.status === "fulfilled") {
    const all = parseDaily(forecastResult.value, true);
    const split = Math.max(0, all.length - FORECAST_DAYS);
    const future = all.slice(split);
    for (const day of all.slice(0, split)) {
      if (day.tMean !== null || day.precipMm !== null) bridge.push(day);
    }
    forecast = {
      model: `${FORECAST_MODEL_LABEL} vía Open-Meteo`,
      days: future,
    };
    sources.push({
      id: "forecast",
      label: `Pronóstico ${FORECAST_MODEL_LABEL}`,
      ok: true,
      detail: `${future.length} días desde ${future[0]?.date ?? "—"}`,
    });
  } else {
    sources.push({
      id: "forecast",
      label: `Pronóstico ${FORECAST_MODEL_LABEL}`,
      ok: false,
      detail: reason(forecastResult),
    });
  }

  const chirps = chirpsResult.status === "fulfilled" ? chirpsResult.value : null;
  // El pronóstico ya trae lluvia de ECMWF, así que el puente no se toca.
  let chirpsDays = 0;

  let climatology: ClimateResponse["climatology"] = null;
  if (climResult.status === "fulfilled") {
    const days = parseDaily(climResult.value);
    // Se sustituye antes de agregar, así mensual, anual y el balance P−ET0
    // quedan todos sobre la misma lluvia.
    if (chirps) chirpsDays += applyChirps(days, chirps);
    const byYear = new Map<number, DailyRecord[]>();
    for (const day of days) {
      const year = Number(day.date.slice(0, 4));
      const list = byYear.get(year);
      if (list) list.push(day);
      else byYear.set(year, [day]);
    }
    const perYearMonthly: ReturnType<typeof monthlyFromDaily>[] = [];
    const byYearAnnual: AnnualRecord[] = [];
    for (const [year, yearDays] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      perYearMonthly.push(monthlyFromDaily(yearDays));
      byYearAnnual.push(
        annualFromDaily(yearDays, year, String(year), daysInYear(year))
      );
    }
    climatology = {
      periodStart: climStart,
      periodEnd: climEnd,
      years: byYear.size,
      model: chirps
        ? usedDemPolygon
          ? "ERA5-Seamless 11–28 km · lluvia CHIRPS 5 km sobre el polígono del DEM"
          : "ERA5-Seamless 11–28 km · lluvia CHIRPS 5 km en la celda del sitio"
        : "ERA5-Seamless vía Open-Meteo · 11–28 km según variable",
      daily: climatologyDaily(byYear),
      monthly: climatologyMonthly(perYearMonthly),
      annual: climatologyAnnual(byYearAnnual),
      byYear: byYearAnnual,
    };
    sources.push({
      id: "climatology",
      label: "Climatología ERA5",
      ok: true,
      detail: `${byYear.size} años, ${climStart} a ${climEnd}`,
    });
  } else {
    sources.push({
      id: "climatology",
      label: "Climatología ERA5",
      ok: false,
      detail: reason(climResult),
    });
  }

  let current: ClimateResponse["currentYear"] = null;
  if (currentResult.status === "fulfilled") {
    const archived = parseDaily(currentResult.value);
    if (chirps) chirpsDays += applyChirps(archived, chirps);
    const seen = new Set(archived.map((d) => d.date));
    const merged = [...archived];
    for (const day of bridge) {
      if (day.date.startsWith(String(currentYear)) && !seen.has(day.date)) {
        merged.push(day);
      }
    }
    merged.sort((a, b) => a.date.localeCompare(b.date));
    current = {
      year: currentYear,
      lastDate: merged.length ? merged[merged.length - 1].date : null,
      daily: merged,
      monthly: monthlyFromDaily(merged),
      annual: annualFromDaily(
        merged,
        currentYear,
        `${currentYear} a la fecha`,
        daysInYear(currentYear)
      ),
    };
    sources.push({
      id: "current",
      label: `Año ${currentYear}`,
      ok: true,
      detail: `${merged.length} días, reanálisis hasta ${
        archived.length ? archived[archived.length - 1].date : "sin dato"
      } y pronóstico para el resto`,
    });
  } else {
    sources.push({
      id: "current",
      label: `Año ${currentYear}`,
      ok: false,
      detail: reason(currentResult),
    });
  }

  if (chirps) {
    sources.push({
      id: "precip",
      label: "Lluvia CHIRPS 0.05°",
      ok: true,
      detail:
        `${chirpsDays} días ` +
        (usedDemPolygon
          ? `sobre el polígono del DEM (${ring.length} vértices)`
          : "en una celda de 0.05° alrededor del punto") +
        `, ${chirps.firstDate} a ${chirps.lastDate}` +
        (chirps.cached ? ", en caché" : `, ${(chirps.elapsedMs / 1000).toFixed(1)} s`),
    });
  } else {
    sources.push({
      id: "precip",
      label: "Lluvia CHIRPS 0.05°",
      ok: false,
      detail: `${reason(chirpsResult as PromiseRejectedResult)} Se grafica la lluvia de ERA5.`,
    });
  }

  const body: ClimateResponse = {
    precip: {
      source: chirps ? "CHIRPS" : "ERA5",
      /** Después de esta fecha la lluvia del año en curso ya no es CHIRPS. */
      chirpsThrough: chirps?.lastDate ?? null,
      forecastModel: FORECAST_MODEL_LABEL,
      areal: Boolean(chirps) && usedDemPolygon,
    },
    site: {
      lat: meta.latitude ?? lat,
      lon: meta.longitude ?? lon,
      elevationM: typeof meta.elevation === "number" ? meta.elevation : null,
      timezone: meta.timezone ?? "UTC",
    },
    climatology,
    currentYear: current,
    forecast,
    sources,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(body);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return buildSeries(
    Number(params.get("lat")),
    Number(params.get("lon")),
    Number(params.get("years") ?? 10),
    parseRing(params.get("poly"))
  );
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    lat?: unknown;
    lon?: unknown;
    years?: unknown;
    ring?: unknown;
    poly?: unknown;
  };
  return buildSeries(
    Number(payload.lat),
    Number(payload.lon),
    Number(payload.years ?? 10),
    parseRingJson(payload.ring ?? payload.poly)
  );
}
