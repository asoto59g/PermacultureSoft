"use client";

import { approxZoomScale } from "@/lib/geo";
import { BASEMAPS } from "@/lib/basemaps";
import type { BasemapId } from "@/lib/types";

type Props = {
  lon: number | null;
  lat: number | null;
  elev: number | null;
  zoom: number;
  status: string | null;
  measure?: { lengthM: number; areaM2?: number } | null;
  hoverInfo: string | null;
  basemap: BasemapId;
  onBasemap: (id: BasemapId) => void;
};

export function StatusBar({
  lon,
  lat,
  elev,
  zoom,
  status,
  measure,
  hoverInfo,
  basemap,
  onBasemap,
}: Props) {
  const scale = lat != null ? approxZoomScale(zoom, lat) : null;

  return (
    <div className="pointer-events-auto flex h-9 w-full items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-3 text-[11px] text-zinc-300 backdrop-blur">
      <div className="flex items-center gap-1">
        {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onBasemap(id)}
            className={`rounded px-2 py-0.5 ${
              basemap === id
                ? "bg-emerald-700 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {BASEMAPS[id].label}
          </button>
        ))}
      </div>

      <span className="h-4 w-px bg-zinc-700" />

      <span className="min-w-[200px] truncate text-zinc-400">
        {status || hoverInfo || "—"}
      </span>

      {measure && (
        <>
          <span className="h-4 w-px bg-zinc-700" />
          <span className="text-amber-300">
            L {measure.lengthM >= 1000 ? `${(measure.lengthM / 1000).toFixed(2)} km` : `${measure.lengthM.toFixed(1)} m`}
            {measure.areaM2 != null &&
              ` · A ${
                measure.areaM2 >= 10000
                  ? `${(measure.areaM2 / 10000).toFixed(2)} ha`
                  : `${measure.areaM2.toFixed(0)} m²`
              }`}
          </span>
        </>
      )}

      <span className="ml-auto flex items-center gap-3 font-mono text-zinc-400">
        {lon != null && lat != null && (
          <span>
            {lat >= 0 ? `${lat.toFixed(5)}° N` : `${Math.abs(lat).toFixed(5)}° S`}{" "}
            {lon >= 0 ? `${lon.toFixed(5)}° E` : `${Math.abs(lon).toFixed(5)}° W`}
          </span>
        )}
        {elev != null && <span>Elev {elev.toFixed(2)} m</span>}
        {scale != null && <span>1:{scale.toLocaleString()}</span>}
        <span>z {zoom.toFixed(1)}</span>
      </span>
    </div>
  );
}
