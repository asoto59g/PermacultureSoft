"use client";

import { useEffect, useMemo, useState } from "react";

import { ClimateChart, type ChartSeries } from "@/components/ClimateChart";
import {
  MONTH_LABELS,
  VARIABLES,
  pickValue,
  smooth,
  variableSpec,
  type ClimateResponse,
  type ClimateVariableId,
  type Resolution,
} from "@/lib/climate";

interface Props {
  lat: number;
  lon: number;
  siteLabel: string;
  /** Anillo lon/lat del DEM. Con él la lluvia es CHIRPS promediada por área. */
  ring?: number[][] | null;
  onClose: () => void;
}

const RESOLUTIONS: { id: Resolution; label: string }[] = [
  { id: "daily", label: "Diaria" },
  { id: "monthly", label: "Mensual" },
  { id: "annual", label: "Anual" },
];

const CLIM_COLOR = "#a1a1aa";

/** El anillo viaja como "lon,lat;lon,lat;…" para que la consulta siga siendo GET. */
function encodeRing(ring: number[][] | null | undefined): string {
  if (!ring || ring.length < 3) return "";
  return ring.map(([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`).join(";");
}

export function ClimatePanel({ lat, lon, siteLabel, ring, onClose }: Props) {
  const [variable, setVariable] = useState<ClimateVariableId>("precipitation");
  const [resolution, setResolution] = useState<Resolution>("monthly");
  const [smoothDaily, setSmoothDaily] = useState(true);
  const [years, setYears] = useState(10);

  // La consulta se identifica por su clave; "cargando" es que el resultado
  // guardado todavía no corresponde a la clave vigente.
  const poly = encodeRing(ring);
  const requestKey = `${lat.toFixed(4)}|${lon.toFixed(4)}|${years}|${poly}`;
  const [result, setResult] = useState<{
    key: string;
    data?: ClimateResponse;
    error?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const [latText, lonText, yearsText, polyText] = requestKey.split("|");
    const query = new URLSearchParams({ lat: latText, lon: lonText, years: yearsText });
    if (polyText) query.set("poly", polyText);
    fetch(`/api/climate/series?${query}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
        return payload as ClimateResponse;
      })
      .then((payload) => {
        if (!cancelled) setResult({ key: requestKey, data: payload });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            error: err instanceof Error ? err.message : "Error de clima",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const loading = result?.key !== requestKey;
  const data = result?.key === requestKey ? (result.data ?? null) : null;
  const error = result?.key === requestKey ? (result.error ?? null) : null;
  // Que CHIRPS no responda degrada la precisión, no rompe el panel: se avisa
  // junto a la variable de lluvia, no con la alarma de fuentes caídas.
  const failed = data?.sources.filter((s) => !s.ok && s.id !== "precip") ?? [];

  const spec = variableSpec(variable);

  const chart = useMemo(() => {
    if (!data) return null;
    const clim = data.climatology;
    const current = data.currentYear;

    if (resolution === "daily") {
      const base = clim?.daily ?? [];
      const categories = base.length
        ? base.map((d) => `${d.day} ${MONTH_LABELS[d.month - 1]}`)
        : (current?.daily ?? []).map((d) => `${d.day} ${MONTH_LABELS[d.month - 1]}`);
      const indexByKey = new Map<string, number>();
      base.forEach((d, i) => {
        indexByKey.set(`${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`, i);
      });
      let climValues = base.map((d) => pickValue(d, variable));
      const currentValues: (number | null)[] = new Array(categories.length).fill(null);
      for (const day of current?.daily ?? []) {
        const key = `${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
        const index = indexByKey.size ? indexByKey.get(key) : day.dayOfYear - 1;
        if (index !== undefined && index >= 0 && index < currentValues.length) {
          currentValues[index] = pickValue(day, variable);
        }
      }
      let currentSmoothed = currentValues;
      if (smoothDaily) {
        climValues = smooth(climValues, 7);
        currentSmoothed = smooth(currentValues, 7);
      }
      const series: ChartSeries[] = [];
      if (climValues.some((v) => v !== null)) {
        series.push({
          name: `Normal ${clim?.years ?? years} años`,
          color: CLIM_COLOR,
          values: climValues,
          type: spec.chart,
        });
      }
      if (currentSmoothed.some((v) => v !== null)) {
        series.push({
          name: `${current?.year ?? "Año actual"}`,
          color: spec.color,
          values: currentSmoothed,
          type: spec.chart,
        });
      }
      const band =
        variable === "temperature" && base.length
          ? {
              lower: base.map((d) => d.tMin),
              upper: base.map((d) => d.tMax),
              color: spec.color,
              name: "Mín–máx normal",
            }
          : undefined;
      return {
        categories,
        series,
        band,
        yLabel: `${spec.label} (${spec.dailyUnit})`,
        xLabel: smoothDaily ? "Día del año · media móvil 7 días" : "Día del año",
      };
    }

    if (resolution === "monthly") {
      const categories = MONTH_LABELS;
      const climValues = categories.map((_, i) => {
        const record = clim?.monthly.find((m) => m.month === i + 1);
        return record ? pickValue(record, variable) : null;
      });
      const currentValues = categories.map((_, i) => {
        const record = current?.monthly.find((m) => m.month === i + 1);
        return record ? pickValue(record, variable) : null;
      });
      const series: ChartSeries[] = [];
      if (climValues.some((v) => v !== null)) {
        series.push({
          name: `Normal ${clim?.years ?? years} años`,
          color: CLIM_COLOR,
          values: climValues,
          type: spec.chart,
        });
      }
      if (currentValues.some((v) => v !== null)) {
        series.push({
          name: `${current?.year ?? "Año actual"}`,
          color: spec.color,
          values: currentValues,
          type: spec.chart,
        });
      }
      const band =
        variable === "temperature"
          ? {
              lower: categories.map(
                (_, i) => clim?.monthly.find((m) => m.month === i + 1)?.tMin ?? null
              ),
              upper: categories.map(
                (_, i) => clim?.monthly.find((m) => m.month === i + 1)?.tMax ?? null
              ),
              color: spec.color,
              name: "Mín–máx normal",
            }
          : undefined;
      return {
        categories,
        series,
        band,
        yLabel: `${spec.label} (${spec.totalUnit}${spec.cumulative ? "/mes" : ""})`,
        xLabel: "Mes",
      };
    }

    const yearRecords = [...(clim?.byYear ?? [])];
    if (current?.annual) yearRecords.push(current.annual);
    const categories = yearRecords.map((y) => String(y.year ?? "—"));
    const values = yearRecords.map((y) => pickValue(y, variable));
    const average = clim?.annual ? pickValue(clim.annual, variable) : null;
    const series: ChartSeries[] = [
      {
        name: "Total por año",
        color: spec.color,
        values,
        type: "bar",
      },
    ];
    if (average !== null) {
      series.push({
        name: `Normal ${clim?.years ?? years} años`,
        color: CLIM_COLOR,
        values: categories.map(() => average),
        type: "line",
        dashed: true,
      });
    }
    return {
      categories,
      series,
      band: undefined,
      yLabel: `${spec.label} (${spec.totalUnit}${spec.cumulative ? "/año" : ""})`,
      xLabel: `Año · el último es parcial hasta ${data.currentYear?.lastDate ?? "hoy"}`,
    };
  }, [data, resolution, variable, smoothDaily, spec, years]);

  const summary = data?.climatology?.annual;
  const currentAnnual = data?.currentYear?.annual;

  return (
    <section className="pointer-events-auto flex h-[26rem] flex-col border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 px-3 py-2">
        <h2 className="text-[12px] font-semibold text-emerald-400">Clima del sitio</h2>
        <span className="text-[11px] text-zinc-400">{siteLabel}</span>
        {data && (
          <span className="text-[10px] text-zinc-500">
            {data.site.lat.toFixed(3)}, {data.site.lon.toFixed(3)}
            {data.site.elevationM !== null && ` · ${data.site.elevationM.toFixed(0)} m`} ·{" "}
            {data.site.timezone}
          </span>
        )}
        {data && (
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] ${
              data.precip.areal
                ? "bg-sky-950 text-sky-300"
                : "bg-zinc-800 text-zinc-400"
            }`}
            title={
              data.precip.areal
                ? "Lluvia promediada sobre el polígono del DEM"
                : "Sin polígono del DEM: la lluvia se muestrea en el punto central"
            }
          >
            Lluvia {data.precip.source}
            {data.precip.areal ? " · por área" : " · puntual"}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1 text-[10px] text-zinc-400">
          Normal
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="rounded bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-200"
          >
            {[5, 10, 20, 30].map((y) => (
              <option key={y} value={y}>
                {y} años
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
        >
          Cerrar
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-800 px-3 py-1.5">
        {VARIABLES.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariable(v.id)}
            className={`rounded px-2 py-1 text-[10px] ${
              variable === v.id
                ? "bg-emerald-700 text-white"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {v.label}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-zinc-800" />
        {RESOLUTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setResolution(r.id)}
            className={`rounded px-2 py-1 text-[10px] ${
              resolution === r.id
                ? "bg-zinc-700 text-white"
                : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {r.label}
          </button>
        ))}
        {resolution === "daily" && (
          <label className="ml-2 flex items-center gap-1 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={smoothDaily}
              onChange={(e) => setSmoothDaily(e.target.checked)}
              className="accent-emerald-500"
            />
            Suavizar 7 días
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading && <p className="animate-pulse text-[11px] text-emerald-400">Consultando series climáticas…</p>}
        {error && (
          <p className="rounded border border-rose-800 bg-rose-950/50 px-2 py-1 text-[11px] text-rose-300">
            {error}
          </p>
        )}

        {failed.length > 0 && (
          <p className="mb-2 rounded border border-amber-800 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
            Sin {failed.map((s) => s.label).join(" ni ")}. Se grafica sólo lo que
            respondió; si fue límite de consultas, reintenta en un minuto.
          </p>
        )}

        {chart && chart.series.length > 0 && (
          <ClimateChart
            categories={chart.categories}
            series={chart.series}
            band={chart.band}
            yLabel={chart.yLabel}
            xLabel={chart.xLabel}
            height={230}
            zeroBased={spec.cumulative}
          />
        )}

        {summary && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Temp. media" value={summary.tMean} unit="°C" now={currentAnnual?.tMean} />
            <Metric label="Lluvia anual" value={summary.precipMm} unit="mm" now={currentAnnual?.precipMm} />
            <Metric label="ET0 anual" value={summary.et0Mm} unit="mm" now={currentAnnual?.et0Mm} />
            <Metric
              label="Balance P−ET0"
              value={
                summary.precipMm !== null && summary.et0Mm !== null
                  ? Math.round(summary.precipMm - summary.et0Mm)
                  : null
              }
              unit="mm"
              now={
                currentAnnual?.precipMm != null && currentAnnual?.et0Mm != null
                  ? Math.round(currentAnnual.precipMm - currentAnnual.et0Mm)
                  : null
              }
            />
            <Metric label="Radiación" value={summary.radiationMj} unit="MJ/m²·d" now={currentAnnual?.radiationMj} />
            <Metric label="Humedad" value={summary.rhPct} unit="%" now={currentAnnual?.rhPct} />
          </div>
        )}

        {data?.forecast && data.forecast.days.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Pronóstico {data.forecast.days.length} días · {data.forecast.model}
            </h3>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {data.forecast.days.map((day) => (
                <div
                  key={day.date}
                  className="min-w-[5.5rem] shrink-0 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
                >
                  <div className="text-[10px] text-zinc-400">
                    {day.day} {MONTH_LABELS[day.month - 1]}
                  </div>
                  <div className="font-mono text-[12px] text-orange-300">
                    {fmt(day.tMax)}° / {fmt(day.tMin)}°
                  </div>
                  <div className="font-mono text-[10px] text-sky-300">{fmt(day.precipMm)} mm</div>
                  <div className="font-mono text-[10px] text-pink-300">ET0 {fmt(day.et0Mm)}</div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {fmt(day.rhPct, 0)}% · {fmt(day.radiationMj, 0)} MJ
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {data && (
          <div className="mt-3 space-y-0.5 border-t border-zinc-800 pt-2 text-[9px] text-zinc-500">
            {data.sources.map((source) => (
              <div key={source.id}>
                <span className={source.ok ? "text-emerald-500" : "text-rose-400"}>
                  {source.ok ? "OK" : "Falla"}
                </span>{" "}
                {source.label} · {source.detail}
              </div>
            ))}
              <div>
                ET0 es evapotranspiración de referencia FAO-56, no evaporación de tanque.
                {data.precip.chirpsThrough &&
                  ` La lluvia es CHIRPS hasta ${data.precip.chirpsThrough}; después ERA5 y ${data.precip.forecastModel}.`}{" "}
                Malla de satélite y reanálisis, no estación meteorológica: úsese como
                insumo de prefactibilidad.
              </div>
          </div>
        )}
      </div>
    </section>
  );
}

function fmt(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function Metric({
  label,
  value,
  unit,
  now,
}: {
  label: string;
  value: number | null;
  unit: string;
  now?: number | null;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-[13px] text-zinc-100">
        {fmt(value)} <span className="text-[9px] text-zinc-500">{unit}</span>
      </div>
      {now !== null && now !== undefined && (
        <div className="font-mono text-[9px] text-emerald-400">Año actual {fmt(now)}</div>
      )}
    </div>
  );
}
