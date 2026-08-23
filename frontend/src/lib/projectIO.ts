import type { DemInfo, LayerNode } from "./types";

export const PROJECT_STORAGE_KEY = "permaculture-project-v1";

export type SavedProject = {
  version: 1;
  savedAt: string;
  dem: DemInfo | null;
  layers: LayerNode[];
  params: Record<string, unknown>;
};

export function stripHeavyLayers(layers: LayerNode[]): LayerNode[] {
  return layers
    .filter((l) => l.kind !== "raster")
    .map((l) => ({ ...l }));
}

export function toSavedProject(
  dem: DemInfo | null,
  layers: LayerNode[],
  params: Record<string, unknown>
): SavedProject {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    dem,
    layers: stripHeavyLayers(layers),
    params,
  };
}

export function downloadProject(project: SavedProject) {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `permaculture-${project.dem?.label || "proyecto"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseProject(raw: unknown): SavedProject {
  const data = raw as SavedProject;
  if (!data || data.version !== 1 || !Array.isArray(data.layers)) {
    throw new Error("JSON de proyecto no válido.");
  }
  return data;
}
