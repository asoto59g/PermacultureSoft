/**
 * Tipos y agregación de series climáticas.
 *
 * Todas las unidades son métricas: °C, mm, MJ/m², %.
 * La "evaporación" es evapotranspiración de referencia ET0 según FAO-56, que es
 * la variable estándar para balance hídrico agrícola, no evaporación de tanque.
 */

export type ClimateVariableId =
  | "temperature"
  | "precipitation"
  | "evapotranspiration"
  | "radiation"
  | "humidity"
  | "balance";

export type Resolution = "daily" | "monthly" | "annual";

/** Un día, ya sea real o promedio climatológico. */
export interface DailyRecord {
  /** ISO YYYY-MM-DD para datos reales, MM-DD para climatología. */
  date: string;
  dayOfYear: number;
  month: number;
  day: number;
  tMean: number | null;
  tMin: number | null;
  tMax: number | null;
  precipMm: number | null;
  et0Mm: number | null;
  radiationMj: number | null;
  rhPct: number | null;
  /** Años promediados en este punto. Sólo en climatología. */
  samples?: number;
}

export interface MonthlyRecord {
  month: number;
  label: string;
  tMean: number | null;
  tMin: number | null;
  tMax: number | null;
  /** Acumulado del mes. */
  precipMm: number | null;
  /** Acumulado del mes. */
  et0Mm: number | null;
  /** Media diaria del mes, no acumulado. */
  radiationMj: number | null;
  rhPct: number | null;
  days: number;
}

export interface AnnualRecord {
  year: number | null;
  label: string;
  tMean: number | null;
  tMin: number | null;
  tMax: number | null;
  precipMm: number | null;
  et0Mm: number | null;
  radiationMj: number | null;
  rhPct: number | null;
  days: number;
  /** Verdadero si al año le faltan días, como el año en curso. */
  partial: boolean;
}

export interface SourceStatus {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ClimateResponse {
  /** De dónde salió la lluvia, que es la variable con más fuentes en juego. */
  precip: {
    source: "CHIRPS" | "ERA5";
    /** Último día con CHIRPS; después la serie vuelve a reanálisis o pronóstico. */
    chirpsThrough: string | null;
    forecastModel: string;
    /** Verdadero si es promedio de área, falso si es un punto. */
    areal: boolean;
  };
  site: {
    lat: number;
    lon: number;
    elevationM: number | null;
    timezone: string;
  };
  climatology: {
    periodStart: string;
    periodEnd: string;
    years: number;
    model: string;
    daily: DailyRecord[];
    monthly: MonthlyRecord[];
    annual: AnnualRecord;
    byYear: AnnualRecord[];
  } | null;
  currentYear: {
    year: number;
    lastDate: string | null;
    daily: DailyRecord[];
    monthly: MonthlyRecord[];
    annual: AnnualRecord;
  } | null;
  forecast: {
    model: string;
    days: DailyRecord[];
  } | null;
  sources: SourceStatus[];
  generatedAt: string;
}

export const MONTH_LABELS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export interface VariableSpec {
  id: ClimateVariableId;
  label: string;
  /** Unidad para resolución diaria. */
  dailyUnit: string;
  /** Unidad para mensual y anual, que difiere en los acumulables. */
  totalUnit: string;
  /** Los acumulables se suman por mes y año; el resto se promedia. */
  cumulative: boolean;
  color: string;
  chart: "line" | "bar";
}

export const VARIABLES: VariableSpec[] = [
  {
    id: "temperature",
    label: "Temperatura",
    dailyUnit: "°C",
    totalUnit: "°C",
    cumulative: false,
    color: "#fb923c",
    chart: "line",
  },
  {
    id: "precipitation",
    label: "Lluvia",
    dailyUnit: "mm/día",
    totalUnit: "mm",
    cumulative: true,
    color: "#38bdf8",
    chart: "bar",
  },
  {
    id: "evapotranspiration",
    label: "Evapotranspiración ET0",
    dailyUnit: "mm/día",
    totalUnit: "mm",
    cumulative: true,
    color: "#f472b6",
    chart: "bar",
  },
  {
    id: "radiation",
    label: "Radiación",
    dailyUnit: "MJ/m²·día",
    totalUnit: "MJ/m²·día",
    cumulative: false,
    color: "#facc15",
    chart: "line",
  },
  {
    id: "humidity",
    label: "Humedad relativa",
    dailyUnit: "%",
    totalUnit: "%",
    cumulative: false,
    color: "#34d399",
    chart: "line",
  },
  {
    id: "balance",
    label: "Balance P − ET0",
    dailyUnit: "mm/día",
    totalUnit: "mm",
    cumulative: true,
    color: "#a78bfa",
    chart: "bar",
  },
];

export function variableSpec(id: ClimateVariableId): VariableSpec {
  return VARIABLES.find((v) => v.id === id) ?? VARIABLES[0];
}

/** Extrae el valor principal de un registro para la variable pedida. */
export function pickValue(
  record: DailyRecord | MonthlyRecord | AnnualRecord,
  id: ClimateVariableId
): number | null {
  switch (id) {
    case "temperature":
      return record.tMean;
    case "precipitation":
      return record.precipMm;
    case "evapotranspiration":
      return record.et0Mm;
    case "radiation":
      return record.radiationMj;
    case "humidity":
      return record.rhPct;
    case "balance":
      return isFiniteNumber(record.precipMm) && isFiniteNumber(record.et0Mm)
        ? round(record.precipMm - record.et0Mm, 2)
        : null;
  }
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, v) => total + v, 0) / values.length;
}

export function sum(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, v) => total + v, 0);
}

export function round(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function collect(records: DailyRecord[], key: keyof DailyRecord): number[] {
  const out: number[] = [];
  for (const record of records) {
    const value = record[key];
    if (isFiniteNumber(value)) out.push(value);
  }
  return out;
}

/** Agrupa días reales en meses. Acumula lluvia y ET0, promedia el resto. */
export function monthlyFromDaily(days: DailyRecord[]): MonthlyRecord[] {
  const buckets = new Map<number, DailyRecord[]>();
  for (const day of days) {
    const list = buckets.get(day.month);
    if (list) list.push(day);
    else buckets.set(day.month, [day]);
  }
  const out: MonthlyRecord[] = [];
  for (const [month, records] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({
      month,
      label: MONTH_LABELS[month - 1],
      tMean: round(mean(collect(records, "tMean"))),
      tMin: round(mean(collect(records, "tMin"))),
      tMax: round(mean(collect(records, "tMax"))),
      precipMm: round(sum(collect(records, "precipMm"))),
      et0Mm: round(sum(collect(records, "et0Mm"))),
      radiationMj: round(mean(collect(records, "radiationMj")), 2),
      rhPct: round(mean(collect(records, "rhPct"))),
      days: records.length,
    });
  }
  return out;
}

/** Resume un año de días reales. */
export function annualFromDaily(
  days: DailyRecord[],
  year: number | null,
  label: string,
  expectedDays: number
): AnnualRecord {
  return {
    year,
    label,
    tMean: round(mean(collect(days, "tMean"))),
    tMin: round(mean(collect(days, "tMin"))),
    tMax: round(mean(collect(days, "tMax"))),
    precipMm: round(sum(collect(days, "precipMm")), 0),
    et0Mm: round(sum(collect(days, "et0Mm")), 0),
    radiationMj: round(mean(collect(days, "radiationMj")), 2),
    rhPct: round(mean(collect(days, "rhPct"))),
    days: days.length,
    partial: days.length < expectedDays,
  };
}

export function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * Promedia día del año a través de varios años. Los acumulables también se
 * promedian aquí: el resultado es "el día típico", no un acumulado.
 */
export function climatologyDaily(byYear: Map<number, DailyRecord[]>): DailyRecord[] {
  const buckets = new Map<string, DailyRecord[]>();
  for (const days of byYear.values()) {
    for (const day of days) {
      const key = `${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
      const list = buckets.get(key);
      if (list) list.push(day);
      else buckets.set(key, [day]);
    }
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((key, index) => {
    const records = buckets.get(key) ?? [];
    const [month, day] = key.split("-").map(Number);
    return {
      date: key,
      dayOfYear: index + 1,
      month,
      day,
      tMean: round(mean(collect(records, "tMean"))),
      tMin: round(mean(collect(records, "tMin"))),
      tMax: round(mean(collect(records, "tMax"))),
      precipMm: round(mean(collect(records, "precipMm")), 2),
      et0Mm: round(mean(collect(records, "et0Mm")), 2),
      radiationMj: round(mean(collect(records, "radiationMj")), 2),
      rhPct: round(mean(collect(records, "rhPct"))),
      samples: records.length,
    };
  });
}

/**
 * Promedia los meses de varios años. Un mes sólo entra si tiene al menos 25
 * días con dato, para que un mes truncado no hunda el promedio de lluvia.
 */
export function climatologyMonthly(perYear: MonthlyRecord[][]): MonthlyRecord[] {
  const out: MonthlyRecord[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const records = perYear
      .flatMap((year) => year.filter((m) => m.month === month))
      .filter((m) => m.days >= 25);
    const pick = (key: keyof MonthlyRecord): number[] =>
      records.map((r) => r[key]).filter(isFiniteNumber);
    out.push({
      month,
      label: MONTH_LABELS[month - 1],
      tMean: round(mean(pick("tMean"))),
      tMin: round(mean(pick("tMin"))),
      tMax: round(mean(pick("tMax"))),
      precipMm: round(mean(pick("precipMm"))),
      et0Mm: round(mean(pick("et0Mm"))),
      radiationMj: round(mean(pick("radiationMj")), 2),
      rhPct: round(mean(pick("rhPct"))),
      days: records.length,
    });
  }
  return out;
}

/** Promedia los años completos. Acumulables promedian el total anual. */
export function climatologyAnnual(years: AnnualRecord[]): AnnualRecord {
  const complete = years.filter((y) => !y.partial);
  const source = complete.length ? complete : years;
  const pick = (key: keyof AnnualRecord): number[] =>
    source.map((y) => y[key]).filter(isFiniteNumber);
  return {
    year: null,
    label: "Promedio",
    tMean: round(mean(pick("tMean"))),
    tMin: round(mean(pick("tMin"))),
    tMax: round(mean(pick("tMax"))),
    precipMm: round(mean(pick("precipMm")), 0),
    et0Mm: round(mean(pick("et0Mm")), 0),
    radiationMj: round(mean(pick("radiationMj")), 2),
    rhPct: round(mean(pick("rhPct"))),
    days: Math.round(mean(source.map((y) => y.days)) ?? 0),
    partial: false,
  };
}

/** Media móvil centrada, para leer la señal diaria bajo el ruido. */
export function smooth(values: (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    const slice: number[] = [];
    for (let i = index - half; i <= index + half; i += 1) {
      const value = values[(i + values.length) % values.length];
      if (isFiniteNumber(value)) slice.push(value);
    }
    return round(mean(slice), 2);
  });
}
