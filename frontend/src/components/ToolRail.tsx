"use client";

import type { ToolId } from "@/lib/types";

type Props = {
  activeTool: ToolId;
  onTool: (tool: ToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasDem: boolean;
};

const TOOLS: { id: ToolId; label: string; group: string; needsDem?: boolean }[] = [
  { id: "select", label: "Seleccionar", group: "nav" },
  { id: "point", label: "Punto", group: "draw" },
  { id: "line", label: "Línea", group: "draw" },
  { id: "polygon", label: "Polígono", group: "draw" },
  { id: "measure", label: "Medir", group: "draw" },
  { id: "watershed", label: "Cuenca", group: "hydro", needsDem: true },
  { id: "pressure-field", label: "Presión", group: "hydro", needsDem: true },
  { id: "pipe", label: "Tubería", group: "hydro", needsDem: true },
  { id: "road", label: "Camino", group: "access", needsDem: true },
  { id: "keyline", label: "Keyline", group: "eco", needsDem: true },
];

export function ToolRail({
  activeTool,
  onTool,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
  hasDem,
}: Props) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/90 px-2 py-1.5 shadow-lg backdrop-blur">
      {TOOLS.map((tool, i) => {
        const prev = TOOLS[i - 1];
        const showDivider = prev && prev.group !== tool.group;
        const disabled = Boolean(tool.needsDem && !hasDem);
        return (
          <span key={tool.id} className="flex items-center">
            {showDivider && <span className="mx-1 h-5 w-px bg-zinc-700" />}
            <button
              type="button"
              disabled={disabled}
              title={tool.label}
              onClick={() => onTool(tool.id)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
                activeTool === tool.id
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-300 hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:opacity-35`}
            >
              {tool.label}
            </button>
          </span>
        );
      })}
      <span className="mx-1 h-5 w-px bg-zinc-700" />
      <button
        type="button"
        disabled={!canUndo}
        onClick={onUndo}
        className="rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
        title="Undo"
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={onRedo}
        className="rounded px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-35"
        title="Redo"
      >
        Redo
      </button>
      <button
        type="button"
        onClick={onClear}
        className="rounded px-2 py-1 text-[11px] text-rose-300 hover:bg-zinc-800"
        title="Limpiar análisis y dibujos"
      >
        Clear
      </button>
    </div>
  );
}
