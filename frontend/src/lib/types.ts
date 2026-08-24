export type ToolId =
  | "select"
  | "point"
  | "line"
  | "polygon"
  | "measure"
  | "watershed"
  | "pipe"
  | "keyline"
  | "road"
  | "pressure-field"
  | "fence";

export type BasemapId = "positron" | "dark" | "satellite" | "topo";

export type PermanenceId =
  | "climate"
  | "geography"
  | "water"
  | "access"
  | "ecosystems"
  | "buildings"
  | "fences"
  | "soils"
  | "economy"
  | "energy";

export type LayerKind =
  | "group"
  | "footprint"
  | "contours"
  | "watershed"
  | "pipe"
  | "keyline"
  | "road"
  | "sites"
  | "fence"
  | "draw"
  | "measure"
  | "surface"
  | "raster";

export interface LayerNode {
  id: string;
  name: string;
  category: PermanenceId;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  data?: unknown;
  meta?: Record<string, unknown>;
}

/** Contorno del DEM en lon/lat: se dibuja y se usa para promediar lluvia por área. */
export interface DemFootprint {
  geojson: FeatureCollection;
  ring: number[][];
  area_ha: number;
  coverage_pct: number;
  /** "mask" sigue las celdas con dato; "extent" es el rectángulo del ráster. */
  source: "mask" | "extent";
}

export interface DemInfo {
  demId: string;
  label: string;
  originalFilename: string;
  crs: string;
  elevationMin: number;
  elevationMax: number;
  interval: number;
  /** Difiere de interval cuando el desnivel obligó a ralear las curvas. */
  intervalEffective?: number;
  bounds: { left: number; bottom: number; right: number; top: number };
  footprint?: DemFootprint | null;
}

export interface BoqLine {
  item: string;
  qty: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface PipeFeature {
  id: string;
  source: [number, number];
  target: [number, number];
  vertices: number[][];
  pressure: number;
  pressureMax?: number;
  elevSrc: number;
  elevTgt: number;
  lengthM?: number;
  dnMm?: number;
  pnBar?: number;
  pnRecommended?: number;
  headlossM?: number;
  residualBar?: number;
  velocityMs?: number;
  elbows?: number;
  flowLs?: number;
  boq?: BoqLine[];
  costRefUsd?: number;
}

export interface RoadFeature {
  id: string;
  waypoints: number[][];
  geojson: FeatureCollection;
  lengthM: number;
  widthM: number;
  maxGradePct: number;
  meanGradePct: number;
  overGradeM: number;
  limitGradePct?: number;
  cutFillM3: number;
  culverts: number;
  boq?: BoqLine[];
  costRefUsd?: number;
}

export type FencePurpose = "lindero" | "potrero" | "cortavientos" | "multifuncional";

export interface FenceFeature {
  id: string;
  vertices: number[][];
  geojson: FeatureCollection;
  species: string;
  speciesName: string;
  purpose: FencePurpose;
  spacingM: number;
  rows: number;
  lengthM: number;
  length3dM: number;
  plantCount: number;
  meanGradePct: number;
  maxGradePct: number;
  steepLengthM: number;
  steepLimitPct: number;
  notes?: string;
  boq?: BoqLine[];
  costRefUsd?: number;
}

export interface DrawFeature {
  id: string;
  kind: "point" | "line" | "polygon" | "measure";
  coordinates: number[][];
  lengthM?: number;
  areaM2?: number;
}

export interface GeoJsonFeature {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface LegendItem {
  index?: number;
  label: string;
  color: string;
  area_ha?: number;
}

export interface SoilProfile {
  clay_pct: number | null;
  sand_pct: number | null;
  silt_pct: number | null;
  om_pct: number | null;
  soc_pct: number | null;
  ph: number | null;
  field_capacity_pct: number | null;
  wilting_point_pct: number | null;
  awc_mm: number | null;
  texture: string;
  root_depth_mm: number;
  source: string;
}

export interface RasterOverlay {
  imagePngBase64: string;
  bounds: { left: number; bottom: number; right: number; top: number };
  legend: LegendItem[];
  source?: { lon: number; lat: number; elevation: number };
  geotiffB64?: string | null;
  geojson?: FeatureCollection | null;
  profile?: SoilProfile | null;
  notes?: string | null;
  annual?: SolarAnnualStats | null;
}

export interface SolarAnnualStats {
  mean_kwh_m2: number;
  min_kwh_m2: number;
  max_kwh_m2: number;
  horizontal_kwh_m2: number;
  ratio_vs_horizontal: number | null;
}

export interface UploadDemResponse {
  status: string;
  dem_id: string;
  original_filename: string;
  label: string;
  crs: string;
  elevation_min: number;
  elevation_max: number;
  interval: number;
  /** Intervalo realmente dibujado; mayor que el pedido si hubo que ralear. */
  interval_effective: number;
  levels_requested: number;
  levels_drawn: number;
  bounds: { left: number; bottom: number; right: number; top: number };
  footprint: DemFootprint | null;
  contours_generated: number;
  geojson: FeatureCollection;
}

export const PERMANENCE_GROUPS: { id: PermanenceId; label: string; index: number }[] = [
  { id: "climate", label: "CLIMATE", index: 1 },
  { id: "geography", label: "GEOGRAPHY", index: 2 },
  { id: "water", label: "WATER", index: 3 },
  { id: "access", label: "ACCESS", index: 4 },
  { id: "ecosystems", label: "ECOSYSTEMS", index: 5 },
  { id: "buildings", label: "BUILDINGS", index: 6 },
  { id: "fences", label: "FENCES", index: 7 },
  { id: "soils", label: "SOILS", index: 8 },
  { id: "economy", label: "ECONOMY", index: 9 },
  { id: "energy", label: "ENERGY", index: 10 },
];
