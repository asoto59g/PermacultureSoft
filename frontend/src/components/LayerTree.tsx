"use client";

import { PERMANENCE_GROUPS, type LayerNode, type PermanenceId } from "@/lib/types";

type Props = {
  layers: LayerNode[];
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
  activeTab: "layers" | "surfaces";
  onTabChange: (tab: "layers" | "surfaces") => void;
};

export function LayerTree({ layers, onToggle, onOpacity, activeTab, onTabChange }: Props) {
  const byCategory = (id: PermanenceId) =>
    layers.filter((l) => {
      if (activeTab === "surfaces") {
        return (
          l.kind === "contours" || l.kind === "surface" || l.kind === "raster"
        );
      }
      return l.category === id && l.kind !== "surface";
    });

  return (
    <div className="flex h-full flex-col text-[12px] text-zinc-200">
      <div className="flex border-b border-zinc-700">
        {(["layers", "surfaces"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`flex-1 px-3 py-2 uppercase tracking-wide ${
              activeTab === tab
                ? "border-b-2 border-emerald-500 text-emerald-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === "surfaces" ? (
          <SurfaceList layers={byCategory("geography")} onToggle={onToggle} onOpacity={onOpacity} />
        ) : (
          PERMANENCE_GROUPS.map((group) => {
            const children = byCategory(group.id);
            return (
              <details key={group.id} open={children.length > 0} className="mb-1">
                <summary className="cursor-pointer select-none rounded px-1 py-1 text-[11px] font-semibold tracking-wide text-zinc-400 hover:bg-zinc-800">
                  {group.index}-{group.label}
                  {children.length > 0 && (
                    <span className="ml-2 font-normal text-zinc-600">{children.length}</span>
                  )}
                </summary>
                <ul className="ml-2 border-l border-zinc-800 pl-2">
                  {children.length === 0 ? (
                    <li className="py-1 text-zinc-600">—</li>
                  ) : (
                    children.map((layer) => (
                      <LayerRow
                        key={layer.id}
                        layer={layer}
                        onToggle={onToggle}
                        onOpacity={onOpacity}
                      />
                    ))
                  )}
                </ul>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}

function SurfaceList({
  layers,
  onToggle,
  onOpacity,
}: {
  layers: LayerNode[];
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
}) {
  if (!layers.length) {
    return <p className="p-2 text-zinc-500">Sin superficies. Sube un DEM.</p>;
  }
  return (
    <ul className="space-y-1">
      {layers.map((layer) => (
        <LayerRow key={layer.id} layer={layer} onToggle={onToggle} onOpacity={onOpacity} />
      ))}
    </ul>
  );
}

function LayerRow({
  layer,
  onToggle,
  onOpacity,
}: {
  layer: LayerNode;
  onToggle: (id: string) => void;
  onOpacity: (id: string, opacity: number) => void;
}) {
  return (
    <li className="rounded px-1 py-1 hover:bg-zinc-800/80">
      <div className="flex items-center gap-2">
        <button
          type="button"
          title={layer.visible ? "Ocultar" : "Mostrar"}
          onClick={() => onToggle(layer.id)}
          className={`h-3 w-3 rounded-sm border ${
            layer.visible
              ? "border-emerald-500 bg-emerald-500/80"
              : "border-zinc-600 bg-transparent"
          }`}
        />
        <span className="flex-1 truncate text-zinc-200">{layer.name}</span>
      </div>
      {layer.visible &&
        (layer.kind === "contours" ||
          layer.kind === "watershed" ||
          layer.kind === "raster") && (
        <input
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          value={layer.opacity}
          onChange={(e) => onOpacity(layer.id, Number(e.target.value))}
          className="mt-1 w-full accent-emerald-500"
        />
      )}
    </li>
  );
}
