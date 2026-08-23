/**
 * Lluvia diaria CHIRPS promediada sobre un polígono, vía ClimateSERV (SERVIR).
 *
 * CHIRPS tiene malla de 0.05° (~5.5 km) contra los 11–28 km de ERA5, así que
 * para lluvia describe mucho mejor un sitio de montaña. El precio es que
 * ClimateSERV trabaja por trabajos asíncronos: se envía, se sondea y se cobra
 * el resultado. Diez años tardan del orden de 30 s, de ahí la caché y el
 * presupuesto de tiempo: si no alcanza, quien llama vuelve a ERA5.
 *
 * Sólo servidor. No importar desde componentes de cliente.
 */

const BASE = "https://climateserv.servirglobal.net/api";

/** Identificador del dataset CHIRPS diario en ClimateSERV. */
const DATATYPE_CHIRPS_DAILY = "0";
/** operationtype 5 = Average, el promedio espacial sobre el polígono. */
const OPERATION_AVERAGE = "5";

const POLL_INTERVAL_MS = 1500;
const REQUEST_TIMEOUT_MS = 30_000;
/** CHIRPS entrega ~0.05°; más de 40 vértices no aportan y alargan la petición. */
const MAX_RING_VERTICES = 40;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface ChirpsSeries {
  /** Fecha ISO YYYY-MM-DD a milímetros del día. */
  byDate: Map<string, number>;
  firstDate: string;
  lastDate: string;
  days: number;
  /** Milisegundos que tardó el trabajo, o 0 si vino de caché. */
  elapsedMs: number;
  cached: boolean;
}

interface CacheEntry {
  at: number;
  value: ChirpsSeries;
}

const cache = new Map<string, CacheEntry>();

/** ClimateSERV a veces devuelve JSON envuelto en cadena, hasta dos veces. */
function unwrap(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (typeof current !== "string") break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current;
}

function usDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

/** Reduce el anillo por muestreo uniforme, conservando el cierre. */
export function trimRing(ring: number[][]): number[][] {
  const open = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  if (open.length < 3) throw new Error("El polígono necesita al menos tres vértices.");

  let kept = open;
  if (open.length > MAX_RING_VERTICES) {
    const stride = open.length / MAX_RING_VERTICES;
    kept = [];
    for (let i = 0; i < MAX_RING_VERTICES; i += 1) {
      kept.push(open[Math.floor(i * stride)]);
    }
  }
  const rounded = kept.map(([lon, lat]) => [
    Math.round(lon * 1e5) / 1e5,
    Math.round(lat * 1e5) / 1e5,
  ]);
  rounded.push(rounded[0]);
  return rounded;
}

async function callApi(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${BASE}/${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ClimateSERV respondió ${response.status}`);
  return unwrap(await response.text());
}

async function submit(ring: number[][], start: string, end: string): Promise<string> {
  const body = new URLSearchParams({
    datatype: DATATYPE_CHIRPS_DAILY,
    begintime: usDate(start),
    endtime: usDate(end),
    intervaltype: "0",
    operationtype: OPERATION_AVERAGE,
    dateType_Category: "default",
    isZip_CurrentDataType: "false",
    geometry: JSON.stringify({ type: "Polygon", coordinates: [ring] }),
  });
  const payload = await callApi("submitDataRequest/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const id = Array.isArray(payload) ? payload[0] : payload;
  if (typeof id !== "string" || !id) throw new Error("ClimateSERV no devolvió identificador de trabajo.");
  return id;
}

async function waitForJob(id: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const raw = await callApi(`getDataRequestProgress/?id=${encodeURIComponent(id)}`);
    const value = Array.isArray(raw) ? raw[0] : raw;
    const progress = Number(value);
    if (!Number.isFinite(progress)) continue;
    if (progress < 0) throw new Error("ClimateSERV reportó el trabajo como fallido.");
    if (progress >= 100) return;
  }
  throw new Error("ClimateSERV tardó más del presupuesto disponible.");
}

interface RawRow {
  isodate?: string;
  date?: string;
  value?: { avg?: number } | number;
}

function collect(rows: RawRow[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const stamp = row.isodate || row.date;
    if (typeof stamp !== "string") continue;
    const [month, day, year] = stamp.split("/");
    if (!year || !month || !day) continue;
    const raw = typeof row.value === "number" ? row.value : row.value?.avg;
    // Los huecos vienen como -9999; nunca como negativo legítimo.
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    byDate.set(`${year}-${month}-${day}`, Math.round(raw * 100) / 100);
  }
  return byDate;
}

/**
 * Serie diaria de lluvia sobre el polígono. Lanza si no alcanza el presupuesto,
 * para que quien llama pueda degradar a otra fuente en lugar de quedarse colgado.
 */
export async function fetchChirpsDaily(
  ring: number[][],
  start: string,
  end: string,
  budgetMs: number
): Promise<ChirpsSeries> {
  const trimmed = trimRing(ring);
  const key = `${start}|${end}|${JSON.stringify(trimmed)}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, elapsedMs: 0, cached: true };
  }

  const started = Date.now();
  const deadline = started + budgetMs;
  const id = await submit(trimmed, start, end);
  await waitForJob(id, deadline);

  const payload = await callApi(`getDataFromRequest/?id=${encodeURIComponent(id)}`);
  const body = payload as { data?: RawRow[]; errMsg?: string };
  if (body?.errMsg) throw new Error(`ClimateSERV: ${body.errMsg}`);

  const byDate = collect(body?.data ?? []);
  if (byDate.size === 0) throw new Error("ClimateSERV no devolvió días con lluvia válida.");

  const dates = [...byDate.keys()].sort();
  const value: ChirpsSeries = {
    byDate,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
    days: byDate.size,
    elapsedMs: Date.now() - started,
    cached: false,
  };

  cache.set(key, { at: Date.now(), value });
  // La caché vive por instancia; sin poda crecería con cada polígono distinto.
  if (cache.size > 24) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return value;
}
