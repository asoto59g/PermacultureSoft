"use client";

import type { LegendItem, RasterOverlay, SoilProfile } from "@/lib/types";
import type { SoilMapType, SurfaceMapType } from "@/lib/api";

type Props = {
  hasDem: boolean;
  loading: boolean;
  resamplePct: number;
  gaussianSigma: number;
  slopeThreshold: number;
  smallestBasinHa: number;
  pressureSource: { lon: number; lat: number } | null;
  legend: LegendItem[] | null;
  legendTitle: string | null;
  onResample: (v: number) => void;
  onGaussian: (v: number) => void;
  onSlopeThreshold: (v: number) => void;
  onBasin: (v: number) => void;
  onSurfaceMap: (kind: SurfaceMapType) => void;
  onDamRebuild: () => void;
  onPressureTool: () => void;
  onParamsReleased: () => void;
  overlay: RasterOverlay | null;
  solarDay: number;
  solarHour: number;
  onSolarDay: (v: number) => void;
  onSolarHour: (v: number) => void;
  onSolarRebuild: () => void;
  onSolarAnnual: () => void;
  onSolarParamsReleased: () => void;
  onSoilMap: (kind: SoilMapType) => void;
  siteMaxSlopePct: number;
  sitePadM: number;
  onSiteSlope: (v: number) => void;
  onSitePad: (v: number) => void;
  onSitesRebuild: () => void;
  roadMaxGradePct: number;
  roadWidthM: number;
  onRoadGrade: (v: number) => void;
  onRoadWidth: (v: number) => void;
  onRoadTool: () => void;
  onConnectSites: () => void;
  siteCount: number;
};

const MAPS: { id: SurfaceMapType; label: string }[] = [
  { id: "slope", label: "Slope" },
  { id: "aspect", label: "Aspect" },
  { id: "hillshade", label: "Hillshade" },
  { id: "elevation", label: "Elevation" },
  { id: "drainage", label: "Drainage" },
  { id: "wetness", label: "Wetness" },
];

const SOIL_MAPS: { id: SoilMapType; label: string }[] = [
  { id: "texture", label: "Textura" },
  { id: "ph", label: "pH" },
  { id: "om", label: "Materia orgánica" },
  { id: "awc", label: "Agua disponible" },
];

export function AnalysisPanel({
  hasDem,
  loading,
  resamplePct,
  gaussianSigma,
  slopeThreshold,
  smallestBasinHa,
  pressureSource,
  legend,
  legendTitle,
  onResample,
  onGaussian,
  onSlopeThreshold,
  onBasin,
  onSurfaceMap,
  onDamRebuild,
  onPressureTool,
  onParamsReleased,
  overlay,
  solarDay,
  solarHour,
  onSolarDay,
  onSolarHour,
  onSolarRebuild,
  onSolarAnnual,
  onSolarParamsReleased,
  onSoilMap,
  siteMaxSlopePct,
  sitePadM,
  onSiteSlope,
  onSitePad,
  onSitesRebuild,
  roadMaxGradePct,
  roadWidthM,
  onRoadGrade,
  onRoadWidth,
  onRoadTool,
  onConnectSites,
  siteCount,
}: Props) {
  const stem = (legendTitle || "analisis").replace(/\s+/g, "_");

  function downloadPng() {
    if (!overlay) return;
    downloadHref(`data:image/png;base64,${overlay.imagePngBase64}`, `${stem}.png`);
  }

  function downloadTif() {
    if (!overlay?.geotiffB64) return;
    downloadHref(
      `data:application/octet-stream;base64,${overlay.geotiffB64}`,
      `${stem}.tif`
    );
  }

  function downloadGeojson() {
    if (!overlay?.geojson) return;
    const blob = new Blob([JSON.stringify(overlay.geojson)], {
      type: "application/geo+json",
    });
    downloadHref(URL.createObjectURL(blob), `${stem}.geojson`);
  }

  return (
    <div className="pointer-events-auto w-72 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950/95 p-3 text-[12px] text-zinc-200">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
        Surfaces / Hydrology
      </h2>

      <label className="mb-2 block">
        <span className="mb-1 flex justify-between text-[10px] uppercase text-zinc-500">
          <span>Resample</span>
          <span>{resamplePct}%</span>
        </span>
        <input
          type="range"
          min={20}
          max={100}
          step={10}
          value={resamplePct}
          onChange={(e) => onResample(Number(e.target.value))}
          onPointerUp={onParamsReleased}
          className="w-full accent-emerald-500"
        />
      </label>

      <label className="mb-3 block">
        <span className="mb-1 flex justify-between text-[10px] uppercase text-zinc-500">
          <span>Gaussian</span>
          <span>{gaussianSigma.toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={3}
          step={0.5}
          value={gaussianSigma}
          onChange={(e) => onGaussian(Number(e.target.value))}
          onPointerUp={onParamsReleased}
          className="w-full accent-emerald-500"
        />
      </label>

      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Maps</p>
      <div className="mb-3 grid grid-cols-2 gap-1">
        {MAPS.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={!hasDem || loading}
            onClick={() => onSurfaceMap(m.id)}
            className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
          Gravity Pressure
        </p>
        <p className="mb-2 text-[11px] text-zinc-400">
          {pressureSource
            ? `Fuente ${pressureSource.lat.toFixed(4)}, ${pressureSource.lon.toFixed(4)}`
            : "Activa la herramienta y click en la fuente."}
        </p>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onPressureTool}
          className="w-full rounded bg-emerald-800 px-2 py-1.5 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Mover la fuente / Rebuild
        </button>
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Dam Suitability
        </p>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Slope threshold</span>
            <span>{slopeThreshold.toFixed(1)}%</span>
          </span>
          <input
            type="range"
            min={2}
            max={25}
            step={0.5}
            value={slopeThreshold}
            onChange={(e) => onSlopeThreshold(Number(e.target.value))}
            onPointerUp={onParamsReleased}
            className="w-full accent-amber-500"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Smallest basin</span>
            <span>{smallestBasinHa} ha</span>
          </span>
          <input
            type="range"
            min={1}
            max={40}
            step={1}
            value={smallestBasinHa}
            onChange={(e) => onBasin(Number(e.target.value))}
            onPointerUp={onParamsReleased}
            className="w-full accent-amber-500"
          />
        </label>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onDamRebuild}
          className="w-full rounded bg-sky-800 px-2 py-1.5 text-[11px] text-white hover:bg-sky-700 disabled:opacity-40"
        >
          Rebuild
        </button>
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Energía · sol
        </p>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Día del año</span>
            <span>{solarDay}</span>
          </span>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={solarDay}
            onChange={(e) => onSolarDay(Number(e.target.value))}
            onPointerUp={onSolarParamsReleased}
            className="w-full accent-amber-400"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Hora local</span>
            <span>{solarHour.toFixed(1)} h</span>
          </span>
          <input
            type="range"
            min={5}
            max={19}
            step={0.5}
            value={solarHour}
            onChange={(e) => onSolarHour(Number(e.target.value))}
            onPointerUp={onSolarParamsReleased}
            className="w-full accent-amber-400"
          />
        </label>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onSolarRebuild}
          className="mb-1 w-full rounded bg-amber-800 px-2 py-1.5 text-[11px] text-white hover:bg-amber-700 disabled:opacity-40"
        >
          Rebuild sombra
        </button>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onSolarAnnual}
          className="w-full rounded bg-amber-950 px-2 py-1.5 text-[11px] text-amber-100 hover:bg-amber-900 disabled:opacity-40"
        >
          Mapa anual
        </button>
        {overlay?.annual && (
          <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
            <p className="font-mono text-[10px]">
              Media {overlay.annual.mean_kwh_m2} kWh/m²·año · {overlay.annual.min_kwh_m2}–
              {overlay.annual.max_kwh_m2}
              {overlay.annual.ratio_vs_horizontal != null
                ? ` · ${Math.round(overlay.annual.ratio_vs_horizontal * 100)}% vs plano`
                : ""}
            </p>
            {overlay.notes && (
              <p className="text-[10px] leading-snug text-zinc-500">{overlay.notes}</p>
            )}
          </div>
        )}
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Suelos
        </p>
        <p className="mb-2 text-[11px] text-zinc-400">
          SoilGrids 250 m, mismas variables que CLIMCOW. No sustituye calicata.
        </p>
        <div className="mb-2 grid grid-cols-2 gap-1">
          {SOIL_MAPS.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!hasDem || loading}
              onClick={() => onSoilMap(m.id)}
              className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              {m.label}
            </button>
          ))}
        </div>
        {overlay?.profile && <SoilProfileBlock profile={overlay.profile} notes={overlay.notes} />}
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Aptitud de edificación
        </p>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Pendiente máx.</span>
            <span>{siteMaxSlopePct.toFixed(0)} %</span>
          </span>
          <input
            type="range"
            min={3}
            max={30}
            step={1}
            value={siteMaxSlopePct}
            onChange={(e) => onSiteSlope(Number(e.target.value))}
            onPointerUp={onParamsReleased}
            className="w-full accent-teal-400"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Plataforma mínima</span>
            <span>{sitePadM} m</span>
          </span>
          <input
            type="range"
            min={10}
            max={80}
            step={5}
            value={sitePadM}
            onChange={(e) => onSitePad(Number(e.target.value))}
            onPointerUp={onParamsReleased}
            className="w-full accent-teal-400"
          />
        </label>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onSitesRebuild}
          className="w-full rounded bg-teal-800 px-2 py-1.5 text-[11px] text-white hover:bg-teal-700 disabled:opacity-40"
        >
          Buscar sitios
        </button>
      </div>

      <div className="mb-3 border-t border-zinc-800 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">
          Acceso · caminos
        </p>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Pendiente máx.</span>
            <span>{roadMaxGradePct} %</span>
          </span>
          <input
            type="range"
            min={4}
            max={45}
            step={1}
            value={roadMaxGradePct}
            onChange={(e) => onRoadGrade(Number(e.target.value))}
            className="w-full accent-orange-400"
          />
        </label>
        <label className="mb-2 block">
          <span className="mb-1 flex justify-between text-[10px] text-zinc-500">
            <span>Ancho</span>
            <span>{roadWidthM.toFixed(1)} m</span>
          </span>
          <input
            type="range"
            min={2}
            max={8}
            step={0.5}
            value={roadWidthM}
            onChange={(e) => onRoadWidth(Number(e.target.value))}
            className="w-full accent-orange-400"
          />
        </label>
        <p className="mb-2 text-[11px] leading-snug text-zinc-400">
          El trazo busca no pasar el tope. Si el terreno no permite, el tramo
          queda en rojo y se listan los metros fuera de norma.
        </p>
        <button
          type="button"
          disabled={!hasDem || loading}
          onClick={onRoadTool}
          className="mb-1 w-full rounded bg-orange-800 px-2 py-1.5 text-[11px] text-white hover:bg-orange-700 disabled:opacity-40"
        >
          Trazar camino
        </button>
        <button
          type="button"
          disabled={!hasDem || loading || siteCount < 2}
          onClick={onConnectSites}
          title={
            siteCount < 2
              ? "Primero Buscar sitios (hacen falta al menos dos)"
              : `Rutas de menor costo desde el sitio #1 a ${Math.min(siteCount - 1, 5)} candidato(s)`
          }
          className="w-full rounded bg-zinc-800 px-2 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Caminos entre sitios
          {siteCount >= 2 ? ` (${Math.min(siteCount - 1, 5)})` : ""}
        </button>
      </div>

      {legend && legend.length > 0 && (
        <div className="border-t border-zinc-800 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">
              {legendTitle || "Leyenda"}
            </p>
            {overlay && (
              <span className="flex gap-2">
                <button type="button" onClick={downloadPng} className="text-[10px] text-emerald-400 hover:underline">
                  PNG
                </button>
                {overlay.geotiffB64 && (
                  <button type="button" onClick={downloadTif} className="text-[10px] text-emerald-400 hover:underline">
                    GeoTIFF
                  </button>
                )}
                {overlay.geojson && (
                  <button type="button" onClick={downloadGeojson} className="text-[10px] text-emerald-400 hover:underline">
                    GeoJSON
                  </button>
                )}
              </span>
            )}
          </div>
          <ul className="space-y-1">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: item.color }}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.area_ha != null && (
                  <span className="font-mono text-zinc-400">{item.area_ha} ha</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SoilProfileBlock({
  profile,
  notes,
}: {
  profile: SoilProfile;
  notes?: string | null;
}) {
  const n = (v: number | null | undefined, unit: string) =>
    v == null ? "—" : `${v} ${unit}`;
  return (
    <div className="space-y-1 text-[11px] text-zinc-400">
      <p>
        Textura <span className="text-zinc-200">{profile.texture}</span>
      </p>
      <p className="font-mono text-[10px]">
        Arcilla {n(profile.clay_pct, "%")} · Arena {n(profile.sand_pct, "%")} · Limo{" "}
        {n(profile.silt_pct, "%")}
      </p>
      <p className="font-mono text-[10px]">
        MO {n(profile.om_pct, "%")} · pH {profile.ph ?? "—"} · AWC {n(profile.awc_mm, "mm")}
      </p>
      {notes && <p className="text-[10px] leading-snug text-zinc-500">{notes}</p>}
    </div>
  );
}

function downloadHref(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}
