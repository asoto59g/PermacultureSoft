"use client";

import { useCallback, useMemo, useReducer, useRef } from "react";
import {
  designLivingFence,
  designPipe,
  designRoad,
  delineateWatershed,
  fetchBuildingSites,
  fetchDamSuitability,
  fetchPressureField,
  fetchSoilMap,
  fetchSolarAnnual,
  fetchSolarMap,
  fetchSurfaceMap,
  generateKeyline,
  rebuildContours,
  sampleElevation,
  uploadDem,
  type LivingFenceResult,
  type RoadDesignResult,
  type SoilMapType,
  type SurfaceMapType,
} from "@/lib/api";
import { formatArea, formatLength, newId, pathLengthMeters, ringAreaMeters2 } from "@/lib/geo";
import {
  PROJECT_STORAGE_KEY,
  downloadProject,
  parseProject,
  toSavedProject,
} from "@/lib/projectIO";
import { FENCE_SPECIES } from "@/lib/fences";
import { aggregateProjectBoq, parsePriceBook, type PriceBook } from "@/lib/economy";
import type {
  BasemapId,
  DemInfo,
  DrawFeature,
  FeatureCollection,
  FenceFeature,
  FencePurpose,
  LayerNode,
  LegendItem,
  PipeFeature,
  RasterOverlay,
  RoadFeature,
  SoilProfile,
  ToolId,
} from "@/lib/types";

type Draft = {
  coords: number[][];
} | null;

type Snapshot = {
  layers: LayerNode[];
};

const SOIL_LAYER: Record<SoilMapType, string> = {
  texture: "Suelos · textura",
  ph: "Suelos · pH",
  om: "Suelos · materia orgánica",
  awc: "Suelos · agua disponible",
};

type State = {
  dem: DemInfo | null;
  layers: LayerNode[];
  past: Snapshot[];
  future: Snapshot[];
  activeTool: ToolId;
  basemap: BasemapId;
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
  siteMaxSlopePct: number;
  sitePadM: number;
  solarDay: number;
  solarHour: number;
  resamplePct: number;
  gaussianSigma: number;
  slopeThreshold: number;
  smallestBasinHa: number;
  pressureSource: { lon: number; lat: number } | null;
  legend: LegendItem[] | null;
  legendTitle: string | null;
  overlayId: string | null;
  activeOverlay: RasterOverlay | null;
  loading: boolean;
  error: string | null;
  statusMessage: string | null;
  draft: Draft;
  pointer: { lon: number; lat: number } | null;
  pointerElev: number | null;
  measureLive: { lengthM: number; areaM2?: number } | null;
  hoverInfo: string | null;
  priceBook: PriceBook;
};

type Action =
  | { type: "SET_TOOL"; tool: ToolId }
  | { type: "SET_BASEMAP"; basemap: BasemapId }
  | { type: "SET_INTERVAL"; interval: number }
  | { type: "SET_KEYLINE_OFFSET"; offset: number }
  | { type: "SET_KEYLINE_COUNT"; count: number }
  | { type: "SET_KEYLINE_MODE"; mode: "contour" | "offset" | "mother" }
  | { type: "SET_KEYLINE_FALL"; fall: number }
  | { type: "SET_KEYLINE_STAKE"; stake: number }
  | { type: "SET_PIPE_DN"; dn: number }
  | { type: "SET_PIPE_FLOW"; flow: number }
  | { type: "SET_ROAD_GRADE"; grade: number }
  | { type: "SET_ROAD_WIDTH"; width: number }
  | { type: "SET_FENCE_SPECIES"; species: string }
  | { type: "SET_FENCE_SPACING"; spacing: number }
  | { type: "SET_FENCE_ROWS"; rows: number }
  | { type: "SET_FENCE_PURPOSE"; purpose: FencePurpose }
  | { type: "SET_SITE_SLOPE"; slope: number }
  | { type: "SET_SITE_PAD"; pad: number }
  | { type: "SET_SOLAR_DAY"; day: number }
  | { type: "SET_SOLAR_HOUR"; hour: number }
  | { type: "SET_RESAMPLE"; pct: number }
  | { type: "SET_GAUSSIAN"; sigma: number }
  | { type: "SET_SLOPE_THRESHOLD"; value: number }
  | { type: "SET_BASIN"; value: number }
  | { type: "SET_PRESSURE_SOURCE"; lon: number; lat: number }
  | { type: "SET_LEGEND"; title: string | null; legend: LegendItem[] | null; overlay: RasterOverlay | null; overlayId: string | null }
  | { type: "UPSERT_LAYER"; layer: LayerNode }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_STATUS"; message: string | null }
  | { type: "SET_POINTER"; lon: number; lat: number; elev: number | null }
  | { type: "SET_HOVER"; text: string | null }
  | { type: "SET_PRICE"; key: string; unitPrice: number }
  | { type: "RESET_PRICES" }
  | { type: "SET_DRAFT"; draft: Draft }
  | { type: "SET_MEASURE_LIVE"; live: State["measureLive"] }
  | { type: "LOAD_DEM"; dem: DemInfo; contours: FeatureCollection }
  | { type: "SET_CONTOURS"; dem: DemInfo; contours: FeatureCollection }
  | { type: "PUSH_LAYER"; layer: LayerNode }
  | { type: "TOGGLE_LAYER"; id: string }
  | { type: "SET_OPACITY"; id: string; opacity: number }
  | { type: "CLEAR_ANALYSIS" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESTORE_PROJECT"; dem: DemInfo | null; layers: LayerNode[]; params: Record<string, unknown> };

function pushHistory(state: State, layers: LayerNode[]): State {
  return {
    ...state,
    layers,
    past: [...state.past.slice(-40), { layers: state.layers }],
    future: [],
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...state,
        activeTool: action.tool,
        draft: null,
        measureLive: null,
        statusMessage: toolHint(action.tool, state.keylineMode),
      };
    case "SET_BASEMAP":
      return { ...state, basemap: action.basemap };
    case "SET_INTERVAL":
      return { ...state, contourInterval: action.interval };
    case "SET_KEYLINE_OFFSET":
      return { ...state, keylineOffsetM: action.offset };
    case "SET_KEYLINE_COUNT":
      return { ...state, keylineCount: action.count };
    case "SET_KEYLINE_MODE":
      return {
        ...state,
        keylineMode: action.mode,
        draft: state.activeTool === "keyline" ? null : state.draft,
        statusMessage:
          state.activeTool === "keyline"
            ? toolHint("keyline", action.mode)
            : state.statusMessage,
      };
    case "SET_KEYLINE_FALL":
      return { ...state, keylineFall: action.fall };
    case "SET_KEYLINE_STAKE":
      return { ...state, keylineStakeM: action.stake };
    case "SET_PIPE_DN":
      return { ...state, pipeDnMm: action.dn };
    case "SET_PIPE_FLOW":
      return { ...state, pipeFlowLs: action.flow };
    case "SET_ROAD_GRADE":
      return { ...state, roadMaxGradePct: action.grade };
    case "SET_ROAD_WIDTH":
      return { ...state, roadWidthM: action.width };
    case "SET_FENCE_SPECIES": {
      const spec = FENCE_SPECIES.find((s) => s.id === action.species);
      return {
        ...state,
        fenceSpecies: action.species,
        fenceSpacingM: spec?.spacing_m ?? state.fenceSpacingM,
        fenceRows: spec?.rows ?? state.fenceRows,
      };
    }
    case "SET_FENCE_SPACING":
      return { ...state, fenceSpacingM: action.spacing };
    case "SET_FENCE_ROWS":
      return { ...state, fenceRows: action.rows };
    case "SET_FENCE_PURPOSE":
      return {
        ...state,
        fencePurpose: action.purpose,
        fenceRows:
          action.purpose === "cortavientos"
            ? Math.max(state.fenceRows, 2)
            : state.fenceRows,
      };
    case "SET_SITE_SLOPE":
      return { ...state, siteMaxSlopePct: action.slope };
    case "SET_SITE_PAD":
      return { ...state, sitePadM: action.pad };
    case "SET_SOLAR_DAY":
      return { ...state, solarDay: action.day };
    case "SET_SOLAR_HOUR":
      return { ...state, solarHour: action.hour };
    case "SET_RESAMPLE":
      return { ...state, resamplePct: action.pct };
    case "SET_GAUSSIAN":
      return { ...state, gaussianSigma: action.sigma };
    case "SET_SLOPE_THRESHOLD":
      return { ...state, slopeThreshold: action.value };
    case "SET_BASIN":
      return { ...state, smallestBasinHa: action.value };
    case "SET_PRESSURE_SOURCE":
      return { ...state, pressureSource: { lon: action.lon, lat: action.lat } };
    case "SET_LEGEND":
      return {
        ...state,
        legend: action.legend,
        legendTitle: action.title,
        overlayId: action.overlayId,
        activeOverlay: action.overlay,
      };
    case "UPSERT_LAYER": {
      const exists = state.layers.some((l) => l.id === action.layer.id);
      const layers = exists
        ? state.layers.map((l) => (l.id === action.layer.id ? action.layer : l))
        : [...state.layers, action.layer];
      return pushHistory(state, layers);
    }
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "SET_STATUS":
      return { ...state, statusMessage: action.message };
    case "SET_POINTER":
      return {
        ...state,
        pointer: { lon: action.lon, lat: action.lat },
        pointerElev: action.elev,
      };
    case "SET_HOVER":
      return { ...state, hoverInfo: action.text };
    case "SET_PRICE":
      return {
        ...state,
        priceBook: { ...state.priceBook, [action.key]: action.unitPrice },
      };
    case "RESET_PRICES":
      return { ...state, priceBook: {} };
    case "SET_DRAFT":
      return { ...state, draft: action.draft };
    case "SET_MEASURE_LIVE":
      return { ...state, measureLive: action.live };
    case "LOAD_DEM": {
      const drawn = action.dem.intervalEffective ?? action.dem.interval;
      const thinned = drawn > action.dem.interval * 1.001;
      const contourLayer: LayerNode = {
        id: "contours",
        name: `Curvas ${fmtInterval(drawn)} m`,
        category: "geography",
        kind: "contours",
        visible: true,
        opacity: 0.85,
        data: action.contours,
        meta: {
          elevMin: action.dem.elevationMin,
          elevMax: action.dem.elevationMax,
        },
      };
      const surfaceLayer: LayerNode = {
        id: "surface-dem",
        name: action.dem.label,
        category: "geography",
        kind: "surface",
        visible: true,
        opacity: 1,
        meta: { demId: action.dem.demId },
      };
      const footprint = action.dem.footprint;
      const footprintLayer: LayerNode | null = footprint
        ? {
            id: "dem-footprint",
            name: `Límite del DEM · ${footprint.area_ha.toFixed(1)} ha`,
            category: "geography",
            kind: "footprint",
            visible: true,
            opacity: 1,
            data: footprint.geojson,
            meta: {
              areaHa: footprint.area_ha,
              coveragePct: footprint.coverage_pct,
              source: footprint.source,
            },
          }
        : null;
      return {
        ...state,
        dem: action.dem,
        layers: [
          ...state.layers.filter(
            (l) =>
              l.kind !== "contours" &&
              l.kind !== "surface" &&
              l.kind !== "footprint" &&
              l.id !== "contours"
          ),
          surfaceLayer,
          ...(footprintLayer ? [footprintLayer] : []),
          contourLayer,
        ],
        past: [],
        future: [],
        error: null,
        statusMessage: thinned
          ? `DEM cargado · ${action.contours.features.length} curvas · ` +
            `el desnivel no admite ${fmtInterval(action.dem.interval)} m, se dibujaron a ${fmtInterval(drawn)} m`
          : `DEM cargado · ${action.contours.features.length} curvas a ${fmtInterval(drawn)} m`,
      };
    }
    case "SET_CONTOURS": {
      const drawn = action.dem.intervalEffective ?? action.dem.interval;
      const thinned = drawn > action.dem.interval * 1.001;
      const contourLayer: LayerNode = {
        id: "contours",
        name: `Curvas ${fmtInterval(drawn)} m`,
        category: "geography",
        kind: "contours",
        visible: true,
        opacity: 0.85,
        data: action.contours,
        meta: {
          elevMin: action.dem.elevationMin,
          elevMax: action.dem.elevationMax,
        },
      };
      const hasContours = state.layers.some((l) => l.kind === "contours");
      return {
        ...state,
        dem: action.dem,
        layers: hasContours
          ? state.layers.map((l) => (l.kind === "contours" ? contourLayer : l))
          : [...state.layers, contourLayer],
        statusMessage: thinned
          ? `${action.contours.features.length} curvas · ` +
            `el desnivel no admite ${fmtInterval(action.dem.interval)} m, se dibujaron a ${fmtInterval(drawn)} m`
          : `${action.contours.features.length} curvas a ${fmtInterval(drawn)} m`,
      };
    }
    case "PUSH_LAYER":
      return pushHistory(state, [...state.layers, action.layer]);
    case "TOGGLE_LAYER":
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.id ? { ...l, visible: !l.visible } : l
        ),
      };
    case "SET_OPACITY":
      return {
        ...state,
        layers: state.layers.map((l) =>
          l.id === action.id ? { ...l, opacity: action.opacity } : l
        ),
      };
    case "CLEAR_ANALYSIS": {
      const kept = state.layers.filter(
        (l) => l.kind === "contours" || l.kind === "surface" || l.kind === "group"
      );
      return pushHistory({ ...state, draft: null, measureLive: null }, kept);
    }
    case "UNDO": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        layers: previous.layers,
        past: state.past.slice(0, -1),
        future: [{ layers: state.layers }, ...state.future],
      };
    }
    case "REDO": {
      if (!state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        layers: next.layers,
        past: [...state.past, { layers: state.layers }],
        future: state.future.slice(1),
      };
    }
    case "RESTORE_PROJECT": {
      const p = action.params;
      return {
        ...state,
        dem: action.dem,
        layers: action.layers,
        past: [],
        future: [],
        contourInterval: Number(p.contourInterval ?? state.contourInterval),
        keylineOffsetM: Number(p.keylineOffsetM ?? state.keylineOffsetM),
        keylineCount: Number(p.keylineCount ?? state.keylineCount),
        keylineMode: (p.keylineMode as State["keylineMode"]) || state.keylineMode,
        keylineFall: Number(p.keylineFall ?? state.keylineFall),
        keylineStakeM: Number(p.keylineStakeM ?? state.keylineStakeM),
        pipeDnMm: Number(p.pipeDnMm ?? state.pipeDnMm),
        pipeFlowLs: Number(p.pipeFlowLs ?? state.pipeFlowLs),
        roadMaxGradePct: Number(p.roadMaxGradePct ?? state.roadMaxGradePct),
        roadWidthM: Number(p.roadWidthM ?? state.roadWidthM),
        fenceSpecies: String(p.fenceSpecies ?? state.fenceSpecies),
        fenceSpacingM: Number(p.fenceSpacingM ?? state.fenceSpacingM),
        fenceRows: Number(p.fenceRows ?? state.fenceRows),
        fencePurpose: (p.fencePurpose as FencePurpose) || state.fencePurpose,
        siteMaxSlopePct: Number(p.siteMaxSlopePct ?? state.siteMaxSlopePct),
        sitePadM: Number(p.sitePadM ?? state.sitePadM),
        solarDay: Number(p.solarDay ?? state.solarDay),
        solarHour: Number(p.solarHour ?? state.solarHour),
        resamplePct: Number(p.resamplePct ?? state.resamplePct),
        gaussianSigma: Number(p.gaussianSigma ?? state.gaussianSigma),
        slopeThreshold: Number(p.slopeThreshold ?? state.slopeThreshold),
        smallestBasinHa: Number(p.smallestBasinHa ?? state.smallestBasinHa),
        basemap: (p.basemap as BasemapId) || state.basemap,
        priceBook: parsePriceBook(p.priceBook),
        legend: null,
        legendTitle: null,
        overlayId: null,
        activeOverlay: null,
        error: null,
        statusMessage: "Proyecto restaurado (vuelve a Rebuild para mapas raster)",
      };
    }
    default:
      return state;
  }
}

function fmtInterval(value: number): string {
  return value < 1 ? value.toFixed(2) : String(Math.round(value * 100) / 100);
}

function toolHint(
  tool: ToolId,
  keylineMode: State["keylineMode"] = "contour"
): string | null {
  switch (tool) {
    case "select":
      return "Seleccionar / navegar";
    case "point":
      return "Click para colocar un punto";
    case "line":
      return "Click vértices · Enter o doble-click para terminar";
    case "polygon":
      return "Click vértices · Enter o doble-click para cerrar";
    case "measure":
      return "Click para medir · Enter o doble-click para terminar";
    case "watershed":
      return "Click en el punto de aforo";
    case "pipe":
      return "Click vértices de la tubería · Enter o doble-click para calcular BoQ";
    case "keyline":
      return keylineMode === "mother"
        ? "Un clic cerca del keypoint: elige la curva madre"
        : "Dos clics: keypoint y luego rumbo de cultivo";
    case "road":
      return "Click origen y destino (o más puntos) · Enter para trazar el camino";
    case "fence":
      return "Click vértices de la cerca viva · Enter o doble-click para plantar";
    case "pressure-field":
      return "Click en el tanque / fuente de gravedad";
    default:
      return null;
  }
}

function roadFromResult(result: RoadDesignResult, id: string): RoadFeature {
  return {
    id,
    waypoints: result.waypoints,
    geojson: result.geojson,
    lengthM: result.length_3d_m,
    widthM: result.width_m,
    maxGradePct: result.max_grade_found_pct,
    meanGradePct: result.mean_grade_pct,
    overGradeM: result.over_grade_length_m,
    limitGradePct: result.max_grade_pct,
    cutFillM3: result.cut_fill_m3,
    culverts: result.culverts,
    boq: result.boq,
    costRefUsd: result.cost_ref_usd,
  };
}

function roadLayerName(road: RoadFeature, prefix = "Camino"): string {
  const m = road.lengthM.toFixed(0);
  const limit = road.limitGradePct ?? 12;
  if (road.overGradeM > 0) {
    return `${prefix} ${m} m · ${road.overGradeM} m sobre ${limit}%`;
  }
  return `${prefix} ${m} m · dentro de ${limit}%`;
}

function roadStatusMessage(road: RoadFeature): string {
  const rest = `${road.cutFillM3} m³ · ${road.culverts} alcantarilla(s)`;
  const limit = road.limitGradePct ?? 12;
  if (road.overGradeM > 0) {
    return (
      `Camino ${road.lengthM} m · FUERA DE NORMA: ${road.overGradeM} m sobre ${limit}% ` +
      `(máx ${road.maxGradePct}%) · ${rest}`
    );
  }
  return (
    `Camino ${road.lengthM} m · pendiente dentro de ${limit}% ` +
    `(máx ${road.maxGradePct}%) · ${rest}`
  );
}

function roadOverWarning(road: RoadFeature): string | null {
  if (road.overGradeM <= 0) return null;
  const limit = road.limitGradePct ?? 12;
  return (
    `Pendiente: ${road.overGradeM} m sobre el tope de ${limit}%. ` +
    `El tramo rojo en el mapa supera el límite.`
  );
}

function fenceFromResult(result: LivingFenceResult, id: string): FenceFeature {
  return {
    id,
    vertices: result.vertices,
    geojson: result.geojson,
    species: result.species,
    speciesName: result.species_name,
    purpose: result.purpose as FencePurpose,
    spacingM: result.spacing_m,
    rows: result.rows,
    lengthM: result.length_2d_m,
    length3dM: result.length_3d_m,
    plantCount: result.plant_count,
    meanGradePct: result.mean_grade_pct,
    maxGradePct: result.max_grade_pct,
    steepLengthM: result.steep_length_m,
    steepLimitPct: result.steep_limit_pct,
    notes: result.notes,
    boq: result.boq,
    costRefUsd: result.cost_ref_usd,
  };
}

function fenceLayerName(fence: FenceFeature): string {
  const steep =
    fence.steepLengthM > 0 ? ` · ${fence.steepLengthM} m > ${fence.steepLimitPct}%` : "";
  return `Cerca ${fence.lengthM} m · ${fence.plantCount} plantas${steep}`;
}

function fenceStatusMessage(fence: FenceFeature): string {
  const steep =
    fence.steepLengthM > 0
      ? ` · ${fence.steepLengthM} m sobre ${fence.steepLimitPct}% (rojo)`
      : "";
  return (
    `${fence.speciesName} · ${fence.lengthM} m · ${fence.plantCount} ` +
    `${fence.rows > 1 ? `en ${fence.rows} hileras` : "plantas"}` +
    ` · máx ${fence.maxGradePct}%${steep}`
  );
}

const initialState: State = {
  dem: null,
  layers: [],
  past: [],
  future: [],
  activeTool: "select",
  basemap: "satellite",
  contourInterval: 5,
  keylineOffsetM: 10,
  keylineCount: 5,
  keylineMode: "contour",
  keylineFall: 400,
  keylineStakeM: 10,
  pipeDnMm: 63,
  pipeFlowLs: 0.5,
  roadMaxGradePct: 12,
  roadWidthM: 4,
  fenceSpecies: "gliricidia",
  fenceSpacingM: 0.5,
  fenceRows: 1,
  fencePurpose: "lindero",
  siteMaxSlopePct: 12,
  sitePadM: 20,
  solarDay: 80,
  solarHour: 10,
  resamplePct: 50,
  gaussianSigma: 0,
  slopeThreshold: 8,
  smallestBasinHa: 8,
  pressureSource: null,
  legend: null,
  legendTitle: null,
  overlayId: null,
  activeOverlay: null,
  loading: false,
  error: null,
  statusMessage: "Sube un DEM GeoTIFF para comenzar",
  draft: null,
  pointer: null,
  pointerElev: null,
  measureLive: null,
  hoverInfo: null,
  priceBook: {},
};

export function useProject() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const elevTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demRef = useRef(state.dem);
  demRef.current = state.dem;

  const handleUpload = useCallback(
    async (file: File) => {
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const data = await uploadDem(file, state.contourInterval);
        const dem: DemInfo = {
          demId: data.dem_id,
          label: data.label,
          originalFilename: data.original_filename,
          crs: data.crs,
          elevationMin: data.elevation_min,
          elevationMax: data.elevation_max,
          interval: data.interval,
          intervalEffective: data.interval_effective ?? data.interval,
          bounds: data.bounds,
          footprint: data.footprint ?? null,
        };
        dispatch({ type: "LOAD_DEM", dem, contours: data.geojson });
        return dem;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error al subir DEM";
        dispatch({ type: "SET_ERROR", error: message });
        return null;
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [state.contourInterval]
  );

  const applyContourInterval = useCallback((interval: number) => {
    dispatch({ type: "SET_INTERVAL", interval });
    if (intervalTimer.current) clearTimeout(intervalTimer.current);
    if (!demRef.current) return;
    intervalTimer.current = setTimeout(async () => {
      const dem = demRef.current;
      if (!dem) return;
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const data = await rebuildContours(dem.demId, interval);
        dispatch({
          type: "SET_CONTOURS",
          dem: {
            ...dem,
            interval: data.interval,
            intervalEffective: data.interval_effective,
          },
          contours: data.geojson,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error al regenerar curvas";
        dispatch({ type: "SET_ERROR", error: message });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    }, 400);
  }, []);

  const onPointerMove = useCallback(
    (lon: number, lat: number) => {
      if (elevTimer.current) clearTimeout(elevTimer.current);
      elevTimer.current = setTimeout(async () => {
        let elev: number | null = null;
        if (state.dem) {
          elev = await sampleElevation(state.dem.demId, lon, lat);
        }
        dispatch({ type: "SET_POINTER", lon, lat, elev });
      }, 120);
    },
    [state.dem]
  );

  const finishDraw = useCallback(
    (kind: DrawFeature["kind"], coords: number[][]) => {
      if (coords.length === 0) return;
      if ((kind === "line" || kind === "measure") && coords.length < 2) return;
      if (kind === "polygon" && coords.length < 3) return;

      const lengthM = pathLengthMeters(coords);
      const areaM2 = kind === "polygon" ? ringAreaMeters2(coords) : undefined;
      const id = newId(kind);
      const name =
        kind === "measure"
          ? `Measure ${formatLength(lengthM)}`
          : kind === "polygon"
            ? `Polygon ${formatArea(areaM2 || 0)}`
            : kind === "line"
              ? `Line ${formatLength(lengthM)}`
              : `Point`;

      const layer: LayerNode = {
        id,
        name,
        category: kind === "measure" ? "geography" : "access",
        kind: kind === "measure" ? "measure" : "draw",
        visible: true,
        opacity: 1,
        data: { id, kind, coordinates: coords, lengthM, areaM2 } satisfies DrawFeature,
      };
      dispatch({ type: "PUSH_LAYER", layer });
      dispatch({ type: "SET_DRAFT", draft: null });
      dispatch({ type: "SET_MEASURE_LIVE", live: null });
      dispatch({
        type: "SET_STATUS",
        message:
          kind === "measure"
            ? `Medición: ${formatLength(lengthM)}${areaM2 ? ` · ${formatArea(areaM2)}` : ""}`
            : `${name} creada`,
      });
    },
    []
  );

  const commitPipe = useCallback(
    async (coords: number[][]) => {
      if (!state.dem || coords.length < 2) return;
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const result = await designPipe(
          state.dem.demId,
          coords,
          state.pipeDnMm,
          state.pipeFlowLs
        );
        const pipe: PipeFeature = {
          id: newId("pipe"),
          source: [coords[0][0], coords[0][1]],
          target: [coords[coords.length - 1][0], coords[coords.length - 1][1]],
          vertices: result.vertices,
          pressure: result.pressure_bar,
          pressureMax: result.pressure_max_bar,
          elevSrc: result.elevation_source,
          elevTgt: result.elevation_target,
          lengthM: result.length_3d_m,
          dnMm: result.dn_mm,
          pnBar: result.pn_bar,
          pnRecommended: result.pn_recommended,
          headlossM: result.headloss_m,
          residualBar: result.residual_bar,
          velocityMs: result.velocity_ms,
          elbows: result.elbows,
          flowLs: result.flow_ls,
          boq: result.boq,
          costRefUsd: result.cost_ref_usd,
        };
        dispatch({
          type: "PUSH_LAYER",
          layer: {
            id: pipe.id,
            name: `DN${pipe.dnMm} ${pipe.lengthM?.toFixed(0)} m · ${pipe.pressure} bar`,
            category: "water",
            kind: "pipe",
            visible: true,
            opacity: 1,
            data: pipe,
          },
        });
        dispatch({
          type: "SET_STATUS",
          message: `Tubería DN${pipe.dnMm} PN${pipe.pnBar}: ${pipe.lengthM} m · ${pipe.pressure} bar residual ${pipe.residualBar} bar`,
        });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Error de tubería",
        });
      } finally {
        dispatch({ type: "SET_DRAFT", draft: null });
        dispatch({ type: "SET_MEASURE_LIVE", live: null });
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [state.dem, state.pipeDnMm, state.pipeFlowLs]
  );

  const commitRoad = useCallback(
    async (coords: number[][]) => {
      if (!state.dem || coords.length < 2) return;
      dispatch({ type: "SET_LOADING", loading: true });
      try {
        const result = await designRoad(
          state.dem.demId,
          coords,
          state.roadMaxGradePct,
          state.roadWidthM,
          state.resamplePct,
          state.gaussianSigma
        );
        const road = roadFromResult(result, newId("road"));
        dispatch({
          type: "PUSH_LAYER",
          layer: {
            id: road.id,
            name: roadLayerName(road),
            category: "access",
            kind: "road",
            visible: true,
            opacity: 1,
            data: road,
          },
        });
        dispatch({ type: "SET_STATUS", message: roadStatusMessage(road) });
        dispatch({ type: "SET_ERROR", error: roadOverWarning(road) });
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Error de camino",
        });
      } finally {
        dispatch({ type: "SET_DRAFT", draft: null });
        dispatch({ type: "SET_MEASURE_LIVE", live: null });
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [
      state.dem,
      state.roadMaxGradePct,
      state.roadWidthM,
      state.resamplePct,
      state.gaussianSigma,
    ]
  );

  const commitFence = useCallback(
    async (coords: number[][]) => {
      if (!state.dem || coords.length < 2) return;
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const result = await designLivingFence(
          state.dem.demId,
          coords,
          state.fenceSpecies,
          state.fenceSpacingM,
          state.fenceRows,
          state.fencePurpose
        );
        const fence = fenceFromResult(result, newId("fence"));
        dispatch({
          type: "PUSH_LAYER",
          layer: {
            id: fence.id,
            name: fenceLayerName(fence),
            category: "fences",
            kind: "fence",
            visible: true,
            opacity: 1,
            data: fence,
          },
        });
        dispatch({ type: "SET_STATUS", message: fenceStatusMessage(fence) });
        if (fence.steepLengthM > 0) {
          dispatch({
            type: "SET_ERROR",
            error:
              `${fence.steepLengthM} m con pendiente > ${fence.steepLimitPct}%. ` +
              "El tramo rojo complica la estaca; acorta o cambia de especie.",
          });
        }
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Error de cerca viva",
        });
      } finally {
        dispatch({ type: "SET_DRAFT", draft: null });
        dispatch({ type: "SET_MEASURE_LIVE", live: null });
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [
      state.dem,
      state.fenceSpecies,
      state.fenceSpacingM,
      state.fenceRows,
      state.fencePurpose,
    ]
  );

  const fencePerimeter = useCallback(async () => {
    const ring = state.dem?.footprint?.ring;
    if (!ring || ring.length < 4) {
      dispatch({
        type: "SET_ERROR",
        error: "Sube un DEM con perímetro para cercar el límite.",
      });
      return;
    }
    await commitFence(ring);
  }, [state.dem, commitFence]);

  const connectSiteRoads = useCallback(async () => {
    if (!state.dem) return;
    const points = sitePointsFromLayers(state.layers);
    if (points.length < 2) {
      dispatch({
        type: "SET_ERROR",
        error: "Primero pulsa Buscar sitios: hacen falta al menos dos candidatos.",
      });
      return;
    }
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    const hub = points[0];
    const spokes = points.slice(1, 6);
    let ok = 0;
    let over = 0;
    try {
      for (const dest of spokes) {
        const result = await designRoad(
          state.dem.demId,
          [hub, dest],
          state.roadMaxGradePct,
          state.roadWidthM,
          state.resamplePct,
          state.gaussianSigma
        );
        const road = roadFromResult(result, newId("road"));
        dispatch({
          type: "PUSH_LAYER",
          layer: {
            id: road.id,
            name: roadLayerName(road, "Acceso sitio"),
            category: "access",
            kind: "road",
            visible: true,
            opacity: 1,
            data: road,
          },
        });
        if (road.overGradeM > 0) over += 1;
        ok += 1;
      }
      dispatch({
        type: "SET_STATUS",
        message:
          over > 0
            ? `${ok} camino(s) desde el sitio #1 · ${over} con tramos sobre ${state.roadMaxGradePct}%`
            : `${ok} camino(s) desde el sitio #1 hacia los demás candidatos`,
      });
      dispatch({
        type: "SET_ERROR",
        error:
          over > 0
            ? `${over} camino(s) tienen tramos sobre el tope de ${state.roadMaxGradePct}%. El tramo rojo en el mapa supera el límite.`
            : null,
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error al sugerir caminos",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [
    state.dem,
    state.layers,
    state.roadMaxGradePct,
    state.roadWidthM,
    state.resamplePct,
    state.gaussianSigma,
  ]);

  const handleMapClick = useCallback(
    async (lon: number, lat: number, isDouble = false) => {
      const tool = state.activeTool;

      if (tool === "select") return;

      if (tool === "point") {
        finishDraw("point", [[lon, lat]]);
        return;
      }

      if (tool === "line" || tool === "polygon" || tool === "measure") {
        const prev = state.draft?.coords || [];
        if (isDouble) {
          const coords = prev.length ? prev : [[lon, lat]];
          finishDraw(tool === "measure" ? "measure" : tool, coords);
          return;
        }
        const coords = [...prev, [lon, lat]];
        dispatch({ type: "SET_DRAFT", draft: { coords } });
        const lengthM = pathLengthMeters(coords);
        const areaM2 =
          tool === "polygon" && coords.length >= 3 ? ringAreaMeters2(coords) : undefined;
        dispatch({ type: "SET_MEASURE_LIVE", live: { lengthM, areaM2 } });
        return;
      }

      if (!state.dem) {
        dispatch({ type: "SET_ERROR", error: "Sube un DEM antes de usar esta herramienta." });
        return;
      }

      if (tool === "watershed") {
        dispatch({ type: "SET_LOADING", loading: true });
        try {
          const geojson = await delineateWatershed(
            state.dem.demId,
            lon,
            lat,
            state.resamplePct,
            state.gaussianSigma
          );
          dispatch({
            type: "PUSH_LAYER",
            layer: {
              id: newId("ws"),
              name: `Watershed`,
              category: "water",
              kind: "watershed",
              visible: true,
              opacity: 0.55,
              data: geojson,
            },
          });
          dispatch({ type: "SET_STATUS", message: "Cuenca delineada" });
        } catch (err) {
          dispatch({
            type: "SET_ERROR",
            error: err instanceof Error ? err.message : "Error en cuenca",
          });
        } finally {
          dispatch({ type: "SET_LOADING", loading: false });
        }
        return;
      }

      if (tool === "pressure-field") {
        dispatch({ type: "SET_PRESSURE_SOURCE", lon, lat });
        dispatch({ type: "SET_LOADING", loading: true });
        try {
          const result = await fetchPressureField(
            state.dem.demId,
            lon,
            lat,
            state.resamplePct,
            state.gaussianSigma
          );
          applyOverlay(
            "pressure-field",
            "Gravity Pressure",
            "water",
            result,
            dispatch
          );
        } catch (err) {
          dispatch({
            type: "SET_ERROR",
            error: err instanceof Error ? err.message : "Error en presión",
          });
        } finally {
          dispatch({ type: "SET_LOADING", loading: false });
        }
        return;
      }

      if (tool === "pipe" || tool === "road" || tool === "fence") {
        const prev = state.draft?.coords || [];
        if (isDouble) {
          const coords = prev.length >= 2 ? prev : [...prev, [lon, lat]];
          if (tool === "pipe") await commitPipe(coords);
          else if (tool === "road") await commitRoad(coords);
          else await commitFence(coords);
          return;
        }
        const coords = [...prev, [lon, lat]];
        dispatch({ type: "SET_DRAFT", draft: { coords } });
        dispatch({
          type: "SET_MEASURE_LIVE",
          live: { lengthM: pathLengthMeters(coords) },
        });
        dispatch({
          type: "SET_STATUS",
          message:
            tool === "pipe"
              ? `Tubería: ${coords.length} vértice(s) · Enter para diseñar`
              : tool === "road"
                ? `Camino: ${coords.length} punto(s) · Enter para trazar`
                : `Cerca viva: ${coords.length} vértice(s) · Enter para plantar`,
        });
        return;
      }

      if (tool === "keyline") {
        const prev = state.draft?.coords || [];
        const coords = [...prev, [lon, lat]];
        const oneClick = state.keylineMode === "mother";
        if (!oneClick && coords.length === 1) {
          dispatch({ type: "SET_DRAFT", draft: { coords } });
          dispatch({
            type: "SET_STATUS",
            message: "Segundo click: rumbo de las líneas de cultivo",
          });
          return;
        }
        const a = coords[0];
        const b = coords[coords.length - 1];
        dispatch({ type: "SET_LOADING", loading: true });
        try {
          const geojson = await generateKeyline(
            a[0],
            a[1],
            b[0],
            b[1],
            state.keylineOffsetM,
            state.keylineCount,
            {
              demId: state.dem.demId,
              mode: state.keylineMode,
              fallRatio: 1 / state.keylineFall,
              resamplePct: state.resamplePct,
              contourInterval: state.contourInterval,
              stakeM: state.keylineStakeM,
            }
          );
          const summary = summarizeKeyline(geojson);
          const base =
            state.keylineMode === "contour"
              ? `Keyline 1:${state.keylineFall}`
              : state.keylineMode === "mother"
                ? `Keyline madre ${state.keylineOffsetM} m`
                : `Keyline offset ${state.keylineOffsetM} m`;
          dispatch({
            type: "PUSH_LAYER",
            layer: {
              id: newId("kl"),
              name: summary.label ? `${base} · ${summary.label}` : base,
              category: "ecosystems",
              kind: "keyline",
              visible: true,
              opacity: 1,
              data: geojson,
            },
          });
          dispatch({ type: "SET_STATUS", message: summary.message });
        } catch (err) {
          dispatch({
            type: "SET_ERROR",
            error: err instanceof Error ? err.message : "Error de herramienta",
          });
        } finally {
          dispatch({ type: "SET_DRAFT", draft: null });
          dispatch({ type: "SET_LOADING", loading: false });
        }
      }
    },
    [
      state.activeTool,
      state.dem,
      state.draft,
      state.keylineOffsetM,
      state.keylineCount,
      state.keylineMode,
      state.keylineFall,
      state.keylineStakeM,
      state.contourInterval,
      state.resamplePct,
      state.gaussianSigma,
      state.pipeDnMm,
      state.pipeFlowLs,
      finishDraw,
      commitPipe,
      commitRoad,
      commitFence,
    ]
  );

  const runSurfaceMap = useCallback(
    async (mapType: SurfaceMapType) => {
      if (!state.dem) return;
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const result = await fetchSurfaceMap(
          state.dem.demId,
          mapType,
          state.resamplePct,
          state.gaussianSigma
        );
        applyOverlay(`map-${mapType}`, mapType, "geography", result, dispatch);
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Error de superficie",
        });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [state.dem, state.resamplePct, state.gaussianSigma]
  );

  const runDamSuitability = useCallback(async () => {
    if (!state.dem) return;
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const result = await fetchDamSuitability(
        state.dem.demId,
        state.slopeThreshold,
        state.smallestBasinHa,
        state.resamplePct,
        state.gaussianSigma
      );
      applyOverlay("dam-suitability", "Dam Suitability", "water", result, dispatch);
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error dam suitability",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [
    state.dem,
    state.slopeThreshold,
    state.smallestBasinHa,
    state.resamplePct,
    state.gaussianSigma,
  ]);

  const rebuildPressure = useCallback(async () => {
    if (!state.dem || !state.pressureSource) {
      dispatch({ type: "SET_TOOL", tool: "pressure-field" });
      return;
    }
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const result = await fetchPressureField(
        state.dem.demId,
        state.pressureSource.lon,
        state.pressureSource.lat,
        state.resamplePct,
        state.gaussianSigma
      );
      applyOverlay("pressure-field", "Gravity Pressure", "water", result, dispatch);
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error en presión",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [state.dem, state.pressureSource, state.resamplePct, state.gaussianSigma]);

  const runBuildingSites = useCallback(async () => {
    if (!state.dem) return;
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const result = await fetchBuildingSites(
        state.dem.demId,
        state.siteMaxSlopePct,
        state.sitePadM,
        state.resamplePct,
        state.gaussianSigma
      );
      applyOverlay("building-sites", "Aptitud edificación", "buildings", result, dispatch);
      const count = result.sites?.features.length ?? 0;
      if (count > 0) {
        dispatch({
          type: "UPSERT_LAYER",
          layer: {
            id: "building-candidates",
            name: `Sitios candidatos (${count})`,
            category: "buildings",
            kind: "sites",
            visible: true,
            opacity: 1,
            data: result.sites,
          },
        });
      }
      dispatch({
        type: "SET_STATUS",
        message: `Aptitud de edificación · ${count} sitio(s) candidato(s)`,
      });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error de aptitud",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [
    state.dem,
    state.siteMaxSlopePct,
    state.sitePadM,
    state.resamplePct,
    state.gaussianSigma,
  ]);

  const runSolar = useCallback(async () => {
    if (!state.dem) return;
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    try {
      const result = await fetchSolarMap(
        state.dem.demId,
        state.solarDay,
        state.solarHour,
        state.resamplePct,
        state.gaussianSigma
      );
      applyOverlay("solar-shade", "Solar / sombra", "climate", result, dispatch);
      if (result.sun) {
        dispatch({
          type: "SET_STATUS",
          message: `Sol az ${result.sun.azimuth_deg}° alt ${result.sun.altitude_deg}°`,
        });
      }
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error solar",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [state.dem, state.solarDay, state.solarHour, state.resamplePct, state.gaussianSigma]);

  const runSolarAnnual = useCallback(async () => {
    if (!state.dem) return;
    dispatch({ type: "SET_LOADING", loading: true });
    dispatch({ type: "SET_ERROR", error: null });
    dispatch({
      type: "SET_STATUS",
      message: "Calculando insolación anual (cielo despejado)…",
    });
    try {
      const result = await fetchSolarAnnual(
        state.dem.demId,
        state.resamplePct,
        state.gaussianSigma
      );
      applyOverlay("solar-annual", "Energía · insolación anual", "energy", result, dispatch);
      const a = result.annual;
      if (a) {
        const vs =
          a.ratio_vs_horizontal != null
            ? ` · ${Math.round(a.ratio_vs_horizontal * 100)}% vs plano`
            : "";
        dispatch({
          type: "SET_STATUS",
          message: `Insolación anual · media ${a.mean_kwh_m2} kWh/m²${vs} (cielo despejado)`,
        });
      }
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "Error de insolación anual",
      });
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }, [state.dem, state.resamplePct, state.gaussianSigma]);

  const runSoilMap = useCallback(
    async (mapType: SoilMapType) => {
      if (!state.dem) return;
      dispatch({ type: "SET_LOADING", loading: true });
      dispatch({ type: "SET_ERROR", error: null });
      try {
        const result = await fetchSoilMap(state.dem.demId, mapType, state.resamplePct);
        applyOverlay(`soil-${mapType}`, SOIL_LAYER[mapType], "soils", result, dispatch);
        const p = result.profile;
        if (p) {
          const bits = [
            p.texture,
            p.om_pct != null ? `MO ${p.om_pct}%` : "",
            p.ph != null ? `pH ${p.ph}` : "",
            p.awc_mm != null ? `AWC ${p.awc_mm} mm` : "",
          ].filter(Boolean);
          dispatch({
            type: "SET_STATUS",
            message: `Suelos · ${bits.join(" · ")}`,
          });
        }
      } catch (err) {
        dispatch({
          type: "SET_ERROR",
          error: err instanceof Error ? err.message : "Error de suelos",
        });
      } finally {
        dispatch({ type: "SET_LOADING", loading: false });
      }
    },
    [state.dem, state.resamplePct]
  );

  const rebuildActiveOverlay = useCallback(async () => {
    const id = state.overlayId;
    if (!id || !state.dem) return;
    if (id.startsWith("map-")) {
      await runSurfaceMap(id.slice(4) as SurfaceMapType);
      return;
    }
    if (id === "pressure-field") {
      await rebuildPressure();
      return;
    }
    if (id === "dam-suitability") {
      await runDamSuitability();
      return;
    }
    if (id === "solar-shade") {
      await runSolar();
      return;
    }
    if (id === "solar-annual") {
      await runSolarAnnual();
      return;
    }
    if (id === "building-sites") {
      await runBuildingSites();
      return;
    }
    if (id.startsWith("soil-")) {
      await runSoilMap(id.slice(5) as SoilMapType);
    }
  }, [
    state.overlayId,
    state.dem,
    runSurfaceMap,
    rebuildPressure,
    runDamSuitability,
    runSolar,
    runSolarAnnual,
    runBuildingSites,
    runSoilMap,
  ]);

  const finishDraft = useCallback(() => {
    const tool = state.activeTool;
    const coords = state.draft?.coords;
    if (!coords?.length) return;
    if (tool === "line" || tool === "polygon" || tool === "measure") {
      finishDraw(tool === "measure" ? "measure" : tool, coords);
    }
    if (tool === "pipe") {
      void commitPipe(coords);
    }
    if (tool === "road") {
      void commitRoad(coords);
    }
    if (tool === "fence") {
      void commitFence(coords);
    }
  }, [state.activeTool, state.draft, finishDraw, commitPipe, commitRoad, commitFence]);

  const cancelDraft = useCallback(() => {
    dispatch({ type: "SET_DRAFT", draft: null });
    dispatch({ type: "SET_MEASURE_LIVE", live: null });
    dispatch({
      type: "SET_STATUS",
      message: toolHint(state.activeTool, state.keylineMode),
    });
  }, [state.activeTool, state.keylineMode]);

  const pipes = useMemo(
    () =>
      state.layers
        .filter((l) => l.kind === "pipe")
        .map((l) => l.data as PipeFeature),
    [state.layers]
  );

  const roads = useMemo(
    () =>
      state.layers
        .filter((l) => l.kind === "road")
        .map((l) => l.data as RoadFeature),
    [state.layers]
  );

  const fences = useMemo(
    () =>
      state.layers
        .filter((l) => l.kind === "fence")
        .map((l) => l.data as FenceFeature),
    [state.layers]
  );

  const boq = useMemo(
    () =>
      aggregateProjectBoq(
        pipes,
        roads,
        fences,
        state.priceBook,
        state.dem?.footprint?.area_ha ?? null
      ),
    [pipes, roads, fences, state.priceBook, state.dem]
  );

  const projectParams = useCallback(
    () => ({
      contourInterval: state.contourInterval,
      keylineOffsetM: state.keylineOffsetM,
      keylineCount: state.keylineCount,
      keylineMode: state.keylineMode,
      keylineFall: state.keylineFall,
      keylineStakeM: state.keylineStakeM,
      pipeDnMm: state.pipeDnMm,
      pipeFlowLs: state.pipeFlowLs,
      roadMaxGradePct: state.roadMaxGradePct,
      roadWidthM: state.roadWidthM,
      fenceSpecies: state.fenceSpecies,
      fenceSpacingM: state.fenceSpacingM,
      fenceRows: state.fenceRows,
      fencePurpose: state.fencePurpose,
      siteMaxSlopePct: state.siteMaxSlopePct,
      sitePadM: state.sitePadM,
      solarDay: state.solarDay,
      solarHour: state.solarHour,
      resamplePct: state.resamplePct,
      gaussianSigma: state.gaussianSigma,
      slopeThreshold: state.slopeThreshold,
      smallestBasinHa: state.smallestBasinHa,
      basemap: state.basemap,
      priceBook: state.priceBook,
    }),
    [
      state.contourInterval,
      state.keylineOffsetM,
      state.keylineCount,
      state.keylineMode,
      state.keylineFall,
      state.keylineStakeM,
      state.pipeDnMm,
      state.pipeFlowLs,
      state.roadMaxGradePct,
      state.roadWidthM,
      state.fenceSpecies,
      state.fenceSpacingM,
      state.fenceRows,
      state.fencePurpose,
      state.siteMaxSlopePct,
      state.sitePadM,
      state.solarDay,
      state.solarHour,
      state.resamplePct,
      state.gaussianSigma,
      state.slopeThreshold,
      state.smallestBasinHa,
      state.basemap,
      state.priceBook,
    ]
  );

  const saveProject = useCallback(
    (download = false) => {
      const project = toSavedProject(state.dem, state.layers, projectParams());
      try {
        localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
      } catch {
        /* quota */
      }
      if (download) downloadProject(project);
      dispatch({
        type: "SET_STATUS",
        message: download ? "Proyecto exportado JSON" : "Proyecto guardado en este navegador",
      });
    },
    [state.dem, state.layers, projectParams]
  );

  const loadProject = useCallback((raw?: string): DemInfo | null => {
    try {
      const text = raw ?? localStorage.getItem(PROJECT_STORAGE_KEY);
      if (!text) {
        dispatch({ type: "SET_ERROR", error: "No hay proyecto guardado en este navegador." });
        return null;
      }
      const project = parseProject(JSON.parse(text));
      dispatch({
        type: "RESTORE_PROJECT",
        dem: project.dem,
        layers: project.layers,
        params: project.params,
      });
      return project.dem;
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        error: err instanceof Error ? err.message : "No se pudo cargar el proyecto",
      });
      return null;
    }
  }, []);

  return {
    state,
    dispatch,
    handleUpload,
    applyContourInterval,
    handleMapClick,
    onPointerMove,
    finishDraft,
    cancelDraft,
    runSurfaceMap,
    runDamSuitability,
    rebuildPressure,
    rebuildActiveOverlay,
    runSolar,
    runSolarAnnual,
    runBuildingSites,
    runSoilMap,
    connectSiteRoads,
    fencePerimeter,
    siteCount: sitePointsFromLayers(state.layers).length,
    saveProject,
    loadProject,
    pipes,
    roads,
    fences,
    boq,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

export type ProjectApi = ReturnType<typeof useProject>;

function sitePointsFromLayers(layers: LayerNode[]): number[][] {
  const layer = layers.find((l) => l.id === "building-candidates");
  const raw = layer?.data as
    | {
        features?: {
          properties?: { rank?: number };
          geometry?: { coordinates?: number[] };
        }[];
      }
    | undefined;
  return (raw?.features ?? [])
    .slice()
    .sort((a, b) => Number(a.properties?.rank ?? 99) - Number(b.properties?.rank ?? 99))
    .map((f) => f.geometry?.coordinates)
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 2)
    .map((c) => [Number(c[0]), Number(c[1])]);
}

function applyOverlay(
  id: string,
  name: string,
  category: LayerNode["category"],
  result: OverlayResponseLike,
  dispatch: (action: Action) => void
) {
  const overlay: RasterOverlay = {
    imagePngBase64: result.image_png_base64,
    bounds: result.bounds,
    legend: result.legend,
    source: result.source,
    geotiffB64: result.geotiff_b64,
    geojson: result.geojson ?? null,
    profile: result.profile ?? null,
    notes: result.notes ?? null,
    annual: result.annual ?? null,
  };
  dispatch({
    type: "UPSERT_LAYER",
    layer: {
      id,
      name,
      category,
      kind: "raster",
      visible: true,
      opacity: 0.85,
      data: overlay,
    },
  });
  dispatch({
    type: "SET_LEGEND",
    title: name,
    legend: result.legend,
    overlay,
    overlayId: id,
  });
  dispatch({ type: "SET_STATUS", message: `${name} actualizado` });
}

type OverlayResponseLike = {
  image_png_base64: string;
  bounds: RasterOverlay["bounds"];
  legend: LegendItem[];
  source?: RasterOverlay["source"];
  geotiff_b64?: string | null;
  geojson?: RasterOverlay["geojson"];
  profile?: SoilProfile | null;
  notes?: string | null;
  annual?: RasterOverlay["annual"];
};

function summarizeKeyline(geojson: FeatureCollection): { label: string; message: string } {
  let accept = 0;
  let review = 0;
  let adjust = 0;
  let redesign = 0;
  let cuts = 0;
  let stakes = 0;
  for (const feat of geojson.features) {
    const t = feat.properties?.type;
    const status = feat.properties?.status;
    if (t === "DrainBreak") cuts += 1;
    if (t === "Stakeout") stakes += 1;
    if (t !== "Keyline") continue;
    if (status === "ACEPTAR") accept += 1;
    else if (status === "REVISAR") review += 1;
    else if (status === "AJUSTAR") adjust += 1;
    else if (status === "REDISENAR") redesign += 1;
  }
  const parts = [
    accept ? `${accept} aceptar` : "",
    review ? `${review} revisar` : "",
    adjust ? `${adjust} ajustar` : "",
    redesign ? `${redesign} rediseñar` : "",
  ].filter(Boolean);
  const label = parts[0] ? parts[0] : "";
  const cutTxt = cuts ? ` · ${cuts} corte${cuts === 1 ? "" : "s"} en drenaje` : "";
  const stakeTxt = stakes ? ` · ${stakes} puntos de replanteo` : "";
  const message = parts.length
    ? `Keyline: ${parts.join(", ")}${cutTxt}${stakeTxt}`
    : "Patrón keyline generado";
  return { label, message };
}
