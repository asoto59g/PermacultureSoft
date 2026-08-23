"use client";

import type { BoqLine, DemInfo, PipeFeature, RoadFeature } from "@/lib/types";

type Props = {
  dem: DemInfo | null;
  contourInterval: number;
  keylineOffsetM: number;
  keylineCount: number;
  keylineMode: "contour" | "offset";
  keylineFall: number;
  pipeDnMm: number;
  pipeFlowLs: number;
  roadMaxGradePct: number;
  roadWidthM: number;
  loading: boolean;
  error: string | null;
  pipes: PipeFeature[];
  roads: RoadFeature[];
  boq: { rows: BoqLine[]; costRefUsd: number };
  onInterval: (v: number) => void;
  onKeylineOffset: (v: number) => void;
  onKeylineCount: (v: number) => void;
  onKeylineMode: (v: "contour" | "offset") => void;
  onKeylineFall: (v: number) => void;
  onPipeDn: (v: number) => void;
  onPipeFlow: (v: number) => void;
  onRoadGrade: (v: number) => void;
  onRoadWidth: (v: number) => void;
  onUpload: (file: File) => void;
  onClimate: () => void;
  climateOpen: boolean;
  onSave: (download: boolean) => void;
  onLoadLocal: () => void;
  onLoadFile: (file: File) => void;
};

const DN = [32, 40, 50, 63, 75, 90, 110, 160, 200];

export function SidePanel({
  dem,
  contourInterval,
  keylineOffsetM,
  keylineCount,
  keylineMode,
  keylineFall,
  pipeDnMm,
  pipeFlowLs,
  roadMaxGradePct,
  roadWidthM,
  loading,
  error,
  pipes,
  roads,
  boq,
  onInterval,
  onKeylineOffset,
  onKeylineCount,
  onKeylineMode,
  onKeylineFall,
  onPipeDn,
  onPipeFlow,
  onRoadGrade,
  onRoadWidth,
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
          <span className="text-zinc-300">{contourInterval} m</span>
        </span>
        <input
          type="range"
          min={1}
          max={50}
          step={1}
          value={contourInterval}
          onChange={(e) => onInterval(Number(e.target.value))}
          className="w-full accent-emerald-500"
        />
      </label>

      <div className="rounded border border-zinc-800 p-2">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">Keyline</p>
        <div className="mb-2 flex gap-1">
          {(["contour", "offset"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onKeylineMode(m)}
              className={`flex-1 rounded px-2 py-1 text-[10px] ${
                keylineMode === m ? "bg-amber-700 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {m === "contour" ? "Contorno 1:n" : "Offset paralelo"}
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
              <span>Offset</span>
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

      {dem && (
        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-400">
          <div className="truncate text-zinc-200">{dem.label}</div>
          <div>CRS {dem.crs}</div>
          <div>
            Elev {dem.elevationMin.toFixed(1)} – {dem.elevationMax.toFixed(1)} m
          </div>
        </div>
      )}

      {(pipes.length > 0 || roads.length > 0) && (
        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Obra · BoQ (USD ref.)
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
                className="rounded border border-yellow-900/50 bg-yellow-950/30 px-2 py-1 text-yellow-200"
              >
                Camino {r.lengthM.toFixed(0)} m · media {r.meanGradePct}% máx{" "}
                {r.maxGradePct}%
                {r.overGradeM > 0 && (
                  <span className="text-rose-300"> · {r.overGradeM} m sobre límite</span>
                )}
                <span className="block text-[10px] text-yellow-400/80">
                  {r.cutFillM3.toFixed(0)} m³ movimiento · {r.culverts} alcantarilla(s)
                </span>
              </li>
            ))}
          </ul>
          {boq.rows.length > 0 && (
            <table className="w-full text-[10px] text-zinc-300">
              <tbody>
                {boq.rows.map((r) => (
                  <tr key={r.item} className="border-t border-zinc-800">
                    <td className="py-0.5 pr-1">{r.item}</td>
                    <td className="py-0.5 text-right font-mono">
                      {r.qty} {r.unit}
                    </td>
                    <td className="py-0.5 text-right font-mono">${r.total.toFixed(0)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-700 font-semibold text-emerald-300">
                  <td className="py-1">Total ref.</td>
                  <td />
                  <td className="py-1 text-right font-mono">${boq.costRefUsd.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
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
