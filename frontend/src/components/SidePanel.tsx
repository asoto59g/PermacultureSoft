"use client";

import type {
  DemInfo,
  FenceFeature,
  FencePurpose,
  PipeFeature,
  RoadFeature,
} from "@/lib/types";
import { FENCE_PURPOSES, FENCE_SPECIES } from "@/lib/fences";
import { downloadBoqCsv, type AggregatedBoq } from "@/lib/economy";

type Props = {
  dem: DemInfo | null;
  contourInterval: number;
  keylineOffsetM: number;
  keylineCount: number;
  keylineMode: "contour" | "offset" | "mother";
  keylineFall: number;
  keylineStakeM: number;
  pipeDnMm: number;
  pipeFlowLs: number;
  roadMaxGradePct: number;
  roadWidthM: number;
  fenceSpecies: string;
  fenceSpacingM: number;
  fenceRows: number;
  fencePurpose: FencePurpose;
  loading: boolean;
  error: string | null;
  pipes: PipeFeature[];
  roads: RoadFeature[];
  fences: FenceFeature[];
  boq: AggregatedBoq;
  onPrice: (key: string, unitPrice: number) => void;
  onResetPrices: () => void;
  onInterval: (v: number) => void;
  onKeylineOffset: (v: number) => void;
  onKeylineCount: (v: number) => void;
  onKeylineMode: (v: "contour" | "offset" | "mother") => void;
  onKeylineFall: (v: number) => void;
  onKeylineStake: (v: number) => void;
  onPipeDn: (v: number) => void;
  onPipeFlow: (v: number) => void;
  onRoadGrade: (v: number) => void;
  onRoadWidth: (v: number) => void;
  onFenceSpecies: (v: string) => void;
  onFenceSpacing: (v: number) => void;
  onFenceRows: (v: number) => void;
  onFencePurpose: (v: FencePurpose) => void;
  onFencePerimeter: () => void;
  onUpload: (file: File) => void;
  onClimate: () => void;
  climateOpen: boolean;
  onSave: (download: boolean) => void;
  onLoadLocal: () => void;
  onLoadFile: (file: File) => void;
};

const DN = [32, 40, 50, 63, 75, 90, 110, 160, 200];

/** Sub-métrico para terreno plano, luego de metro en metro. */
const CONTOUR_INTERVALS = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function formatInterval(value: number): string {
  return value < 1 ? value.toFixed(2) : String(value);
}

/** Un proyecto guardado puede traer un intervalo fuera de la escala; se ajusta al más cercano. */
function intervalIndex(value: number): number {
  let best = 0;
  for (let i = 1; i < CONTOUR_INTERVALS.length; i += 1) {
    if (Math.abs(CONTOUR_INTERVALS[i] - value) < Math.abs(CONTOUR_INTERVALS[best] - value)) {
      best = i;
    }
  }
  return best;
}

export function SidePanel({
  dem,
  contourInterval,
  keylineOffsetM,
  keylineCount,
  keylineMode,
  keylineFall,
  keylineStakeM,
  pipeDnMm,
  pipeFlowLs,
  roadMaxGradePct,
  roadWidthM,
  fenceSpecies,
  fenceSpacingM,
  fenceRows,
  fencePurpose,
  loading,
  error,
  pipes,
  roads,
  fences,
  boq,
  onPrice,
  onResetPrices,
  onInterval,
  onKeylineOffset,
  onKeylineCount,
  onKeylineMode,
  onKeylineFall,
  onKeylineStake,
  onPipeDn,
  onPipeFlow,
  onRoadGrade,
  onRoadWidth,
  onFenceSpecies,
  onFenceSpacing,
  onFenceRows,
  onFencePurpose,
  onFencePerimeter,
  onUpload,
  onClimate,
  climateOpen,
  onSave,
  onLoadLocal,
  onLoadFile,
}: Props) {
  return (
    <div className="flex flex-col gap-4 border-b border-zinc-800 p-3 text-[12px] text-zinc-200">
      <div>
        <h1 className="text-sm font-semibold tracking-wide text-emerald-400">
          PermacultureSoft
        </h1>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500">
          Topografía · Hidrología · Diseño
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
          DEM GeoTIFF
        </span>
        <input
          type="file"
          accept=".tif,.tiff"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
          }}
          className="block w-full cursor-pointer text-[11px] text-zinc-400 file:mr-2 file:rounded file:border-0 file:bg-emerald-700 file:px-2 file:py-1 file:text-[11px] file:text-white"
        />
      </label>

      <button
        type="button"
        onClick={onClimate}
        className={`rounded px-2 py-1.5 text-[11px] ${
          climateOpen
            ? "bg-emerald-700 text-white"
            : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
        }`}
      >
        {climateOpen ? "Ocultar clima del sitio" : "Clima del sitio"}
      </button>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onSave(false)}
          className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={() => onSave(true)}
          className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700"
        >
          Exportar JSON
        </button>
        <button
          type="button"
          onClick={onLoadLocal}
          className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700"
        >
          Abrir local
        </button>
        <label className="cursor-pointer rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700">
          Importar
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 flex justify-between text-[10px] uppercase tracking-wide text-zinc-500">
          <span>Intervalo curvas</span>
          <span className="text-zinc-300">{formatInterval(contourInterval)} m</span>
        </span>
        <input
          type="range"
          min={0}
          max={CONTOUR_INTERVALS.length - 1}
          step={1}
          value={intervalIndex(contourInterval)}
          onChange={(e) => onInterval(CONTOUR_INTERVALS[Number(e.target.value)])}
          className="w-full accent-emerald-500"
        />
        <span className="flex justify-between text-[9px] text-zinc-600">
          <span>0.25</span>
          <span>1</span>
          <span>10 m</span>
        </span>
      </label>

      <div className="rounded border border-zinc-800 p-2">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">Keyline</p>
        <div className="mb-2 flex gap-1">
          {(
            [
              ["contour", "Contorno 1:n"],
              ["offset", "Offset"],
              ["mother", "Madre"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => onKeylineMode(m)}
              className={`flex-1 rounded px-1 py-1 text-[10px] ${
                keylineMode === m ? "bg-amber-700 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {keylineMode === "contour" ? (
          <label className="block">
            <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
              <span>Caída</span>
              <span>1:{keylineFall}</span>
            </span>
            <input
              type="range"
              min={200}
              max={800}
              step={50}
              value={keylineFall}
              onChange={(e) => onKeylineFall(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
              <span>{keylineMode === "mother" ? "Espaciamiento" : "Offset"}</span>
              <span>{keylineOffsetM} m</span>
            </span>
            <input
              type="range"
              min={2}
              max={50}
              step={1}
              value={keylineOffsetM}
              onChange={(e) => onKeylineOffset(Number(e.target.value))}
              className="w-full accent-amber-500"
            />
          </label>
        )}
        <label className="mt-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Líneas</span>
            <span>{keylineCount}</span>
          </span>
          <input
            type="range"
            min={2}
            max={12}
            step={1}
            value={keylineCount}
            onChange={(e) => onKeylineCount(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </label>
        <label className="mt-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Replanteo</span>
            <span>{keylineStakeM} m</span>
          </span>
          <input
            type="range"
            min={5}
            max={25}
            step={1}
            value={keylineStakeM}
            onChange={(e) => onKeylineStake(Number(e.target.value))}
            className="w-full accent-amber-500"
          />
        </label>
        <p className="mt-2 text-[10px] leading-snug text-zinc-500">
          {keylineMode === "mother"
            ? "Un clic cerca del keypoint: elige una curva madre y lanza offsets. "
            : "Dos clics: keypoint y rumbo. "}
          Semáforo ICL. Cortes en vaguadas. Puntos blancos = replanteo (cota del
          DEM). Quedan en el GeoJSON de la capa.
        </p>
      </div>

      <div className="rounded border border-zinc-800 p-2">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Tubería (PE)
        </p>
        <label className="mb-2 block">
          <span className="mb-1 block text-[10px] text-zinc-500">DN mm</span>
          <select
            value={pipeDnMm}
            onChange={(e) => onPipeDn(Number(e.target.value))}
            className="w-full rounded bg-zinc-900 px-2 py-1 text-[11px]"
          >
            {DN.map((d) => (
              <option key={d} value={d}>
                DN {d}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Caudal diseño</span>
            <span>{pipeFlowLs.toFixed(2)} L/s</span>
          </span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={pipeFlowLs}
            onChange={(e) => onPipeFlow(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
        </label>
      </div>

      <div className="rounded border border-zinc-800 p-2">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Camino
        </p>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Pendiente máx.</span>
            <span>{roadMaxGradePct} %</span>
          </span>
          <input
            type="range"
            min={4}
            max={25}
            step={1}
            value={roadMaxGradePct}
            onChange={(e) => onRoadGrade(Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
        </label>
        <p className="mb-2 text-[10px] leading-snug text-zinc-500">
          Tope de diseño. Si el terreno no da, el tramo queda en rojo y se
          reportan los metros fuera de norma.
        </p>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Ancho de calzada</span>
            <span>{roadWidthM.toFixed(1)} m</span>
          </span>
          <input
            type="range"
            min={2.5}
            max={10}
            step={0.5}
            value={roadWidthM}
            onChange={(e) => onRoadWidth(Number(e.target.value))}
            className="w-full accent-yellow-500"
          />
        </label>
      </div>

      <div className="rounded border border-zinc-800 p-2">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Cerca viva
        </p>
        <label className="mb-2 block">
          <span className="mb-1 block text-[10px] text-zinc-500">Especie</span>
          <select
            value={fenceSpecies}
            onChange={(e) => onFenceSpecies(e.target.value)}
            className="w-full rounded bg-zinc-900 px-2 py-1 text-[11px]"
          >
            {FENCE_SPECIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-2 block">
          <span className="mb-1 block text-[10px] text-zinc-500">Función</span>
          <select
            value={fencePurpose}
            onChange={(e) => onFencePurpose(e.target.value as FencePurpose)}
            className="w-full rounded bg-zinc-900 px-2 py-1 text-[11px]"
          >
            {FENCE_PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Espaciamiento</span>
            <span>{fenceSpacingM.toFixed(2)} m</span>
          </span>
          <input
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={fenceSpacingM}
            onChange={(e) => onFenceSpacing(Number(e.target.value))}
            className="w-full accent-lime-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Hileras</span>
            <span>{fenceRows}</span>
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={1}
            value={fenceRows}
            onChange={(e) => onFenceRows(Number(e.target.value))}
            className="w-full accent-lime-500"
          />
        </label>
        <p className="mt-2 text-[10px] leading-snug text-zinc-500">
          Click vértices, Enter para plantar. Corta-vientos usa al menos 2
          hileras. Precios de estaca, no cotización.
        </p>
        <button
          type="button"
          disabled={!dem || loading}
          onClick={onFencePerimeter}
          className="mt-2 w-full rounded bg-lime-900 px-2 py-1.5 text-[11px] text-white hover:bg-lime-800 disabled:opacity-40"
        >
          Cercar perímetro del DEM
        </button>
      </div>

      {dem && (
        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
          <div className="truncate text-zinc-200">{dem.label}</div>
          <div>CRS {dem.crs}</div>
          <div>
            Elev {dem.elevationMin.toFixed(1)} – {dem.elevationMax.toFixed(1)} m
          </div>
        </div>
      )}

      {(pipes.length > 0 || roads.length > 0 || fences.length > 0 || boq.rows.length > 0) && (
        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            9 · Economía · BoQ (USD ref.)
          </h3>
          <ul className="mb-2 space-y-1">
            {pipes.map((p) => (
              <li
                key={p.id}
                className="rounded border border-rose-900/50 bg-rose-950/40 px-2 py-1 text-rose-200"
              >
                DN{p.dnMm ?? "—"} PN{p.pnBar ?? "—"} · {p.lengthM?.toFixed(0) ?? "?"} m ·{" "}
                {p.pressure} bar
                {p.velocityMs != null && ` · ${p.velocityMs.toFixed(2)} m/s`}
              </li>
            ))}
            {roads.map((r) => (
              <li
                key={r.id}
                className={`rounded border px-2 py-1 ${
                  r.overGradeM > 0
                    ? "border-rose-800 bg-rose-950/40 text-rose-200"
                    : "border-yellow-900/50 bg-yellow-950/30 text-yellow-200"
                }`}
              >
                Camino {r.lengthM.toFixed(0)} m · media {r.meanGradePct}% máx{" "}
                {r.maxGradePct}%
                {r.overGradeM > 0 && (
                  <span className="font-medium">
                    {" "}
                    · {r.overGradeM} m sobre {r.limitGradePct ?? 12}%
                  </span>
                )}
                <span className="block text-[10px] text-yellow-400/80">
                  {r.cutFillM3.toFixed(0)} m³ movimiento · {r.culverts} alcantarilla(s)
                </span>
              </li>
            ))}
            {fences.map((f) => (
              <li
                key={f.id}
                className={`rounded border px-2 py-1 ${
                  f.steepLengthM > 0
                    ? "border-rose-800 bg-rose-950/40 text-rose-200"
                    : "border-lime-900/50 bg-lime-950/30 text-lime-200"
                }`}
              >
                {f.speciesName.split("(")[0].trim()} · {f.lengthM.toFixed(0)} m ·{" "}
                {f.plantCount} plantas
                {f.steepLengthM > 0 && (
                  <span className="block text-[10px]">
                    {f.steepLengthM} m sobre {f.steepLimitPct}%
                  </span>
                )}
              </li>
            ))}
          </ul>
          {boq.rows.length > 0 && (
            <>
              <p className="mb-1 grid grid-cols-3 gap-1 text-[10px] text-zinc-500">
                <span>Agua ${boq.byCategory.water.toFixed(0)}</span>
                <span>Acceso ${boq.byCategory.access.toFixed(0)}</span>
                <span>Cercas ${boq.byCategory.fences.toFixed(0)}</span>
              </p>
              <table className="w-full text-[10px] text-zinc-300">
                <tbody>
                  {boq.rows.map((r) => (
                    <tr key={r.key} className="border-t border-zinc-800">
                      <td className="py-0.5 pr-1">
                        {r.item}
                        <span className="block font-mono text-zinc-500">
                          {r.qty} {r.unit}
                        </span>
                      </td>
                      <td className="py-0.5 text-right">
                        <label className="inline-flex items-center gap-0.5">
                          <span className="text-zinc-600">$</span>
                          <input
                            type="number"
                            min={0}
                            step={0.05}
                            value={r.unit_price}
                            onChange={(e) =>
                              onPrice(r.key, Math.max(0, Number(e.target.value) || 0))
                            }
                            className={`w-14 rounded bg-zinc-900 px-1 py-0.5 text-right font-mono ${
                              r.edited ? "text-amber-300" : "text-zinc-200"
                            }`}
                          />
                        </label>
                      </td>
                      <td className="py-0.5 text-right font-mono">${r.total.toFixed(0)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-700 font-semibold text-emerald-300">
                    <td className="py-1">Total ref.</td>
                    <td />
                    <td className="py-1 text-right font-mono">${boq.costRefUsd.toFixed(0)}</td>
                  </tr>
                  {boq.usdPerHa != null && (
                    <tr className="text-zinc-400">
                      <td className="py-0.5">USD / ha</td>
                      <td />
                      <td className="py-0.5 text-right font-mono">
                        ${boq.usdPerHa.toFixed(0)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="mt-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => downloadBoqCsv(boq, dem?.label || "proyecto")}
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={onResetPrices}
                  className="rounded bg-zinc-800 px-2 py-1 text-[10px] hover:bg-zinc-700"
                >
                  Precios de código
                </button>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-zinc-500">
                Edita el precio unitario para tu mercado. No es cotización: sin
                flete, imprevistos ni rendimiento de cuadrilla.
              </p>
            </>
          )}
        </div>
      )}

      {loading && <p className="animate-pulse text-emerald-400">Procesando…</p>}
      {error && (
        <p className="rounded border border-rose-800 bg-rose-950/50 px-2 py-1 text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
