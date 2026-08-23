import type { BasemapId } from "./types";

export const BASEMAPS: Record<
  BasemapId,
  { label: string; style: string | { version: number; sources: Record<string, unknown>; layers: unknown[] } }
> = {
  positron: {
    label: "Calles",
    style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  },
  dark: {
    label: "Oscuro",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  },
  satellite: {
    label: "Satélite",
    style: {
      version: 8,
      sources: {
        esri: {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          attribution: "Esri, Maxar, Earthstar Geographics",
        },
      },
      layers: [{ id: "esri", type: "raster", source: "esri" }],
    },
  },
  topo: {
    label: "Topo",
    style: {
      version: 8,
      sources: {
        otm: {
          type: "raster",
          tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap, © OpenTopoMap (CC-BY-SA)",
        },
      },
      layers: [{ id: "otm", type: "raster", source: "otm" }],
    },
  },
};
