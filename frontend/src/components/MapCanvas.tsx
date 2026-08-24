"use client";

import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import {
  BitmapLayer,
  GeoJsonLayer,
  PathLayer,
  ScatterplotLayer,
  PolygonLayer,
} from "@deck.gl/layers";
import { TerrainLayer } from "@deck.gl/geo-layers";
import MapGL from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS } from "@/lib/basemaps";
import { elevationColor } from "@/lib/geo";
import type {
  BasemapId,
  DrawFeature,
  FeatureCollection,
  FenceFeature,
  LayerNode,
  PipeFeature,
  RasterOverlay,
  RoadFeature,
  ToolId,
} from "@/lib/types";

export type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  maxZoom?: number;
  pitch: number;
  bearing: number;
};

type Props = {
  viewState: ViewState;
  onViewStateChange: (vs: ViewState) => void;
  layers: LayerNode[];
  draft: { coords: number[][] } | null;
  activeTool: ToolId;
  basemap: BasemapId;
  showTerrain: boolean;
  onClick: (lon: number, lat: number, isDouble: boolean) => void;
  onHoverMove: (lon: number, lat: number) => void;
  onHoverFeature: (text: string | null) => void;
};

const TERRAIN_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// deck.gl accessor typings are strict; keep layer construction practical.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLayer = any;

export function MapCanvas({
  viewState,
  onViewStateChange,
  layers,
  draft,
  activeTool,
  basemap,
  showTerrain,
  onClick,
  onHoverMove,
  onHoverFeature,
}: Props) {
  const deckLayers = useMemo(() => {
    const result: AnyLayer[] = [];

    if (showTerrain && viewState.pitch > 5) {
      result.push(
        new TerrainLayer({
          id: "terrain",
          elevationDecoder: {
            rScaler: 256,
            gScaler: 1,
            bScaler: 1 / 256,
            offset: -32768,
          },
          elevationData: TERRAIN_URL,
          texture: null,
          color: [40, 40, 40, 120],
          operation: "terrain",
        })
      );
    }

    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.kind !== "raster") continue;
      const overlay = layer.data as RasterOverlay;
      const b = overlay.bounds;
      result.push(
        new BitmapLayer({
          id: layer.id,
          image: `data:image/png;base64,${overlay.imagePngBase64}`,
          bounds: [b.left, b.bottom, b.right, b.top],
          parameters: { depthTest: false },
          opacity: layer.opacity,
        })
      );
    }

    for (const layer of layers) {
      if (!layer.visible) continue;
      const opacity = Math.round(layer.opacity * 255);

      if (layer.kind === "contours") {
        const elevMin = Number(layer.meta?.elevMin ?? 0);
        const elevMax = Number(layer.meta?.elevMax ?? 1);
        const fc = layer.data as FeatureCollection;
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: fc as never,
            pickable: true,
            stroked: true,
            filled: false,
            lineWidthMinPixels: 1,
            parameters: { depthTest: false },
            getLineColor: (f: { properties?: { elevation?: number; major?: boolean } }) =>
              elevationColor(
                f.properties?.elevation ?? elevMin,
                elevMin,
                elevMax,
                f.properties?.major === false ? Math.round(opacity * 0.7) : opacity
              ),
            getLineWidth: (f: { properties?: { major?: boolean } }) =>
              f.properties?.major === false ? 0.7 : 1.4,
            updateTriggers: {
              getLineColor: [elevMin, elevMax, opacity],
              getLineWidth: [opacity],
            },
          })
        );
      }

      if (layer.kind === "watershed") {
        const raw = layer.data as { type?: string; features?: unknown[] } | null;
        const data =
          raw?.type === "FeatureCollection"
            ? raw
            : raw?.type === "Feature"
              ? { type: "FeatureCollection", features: [raw] }
              : raw;
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: data as never,
            stroked: true,
            filled: true,
            pickable: true,
            extruded: false,
            getFillColor: [40, 160, 255, Math.max(90, Math.min(180, opacity))],
            getLineColor: [0, 220, 255, 255],
            lineWidthMinPixels: 3,
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "footprint") {
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: layer.data as never,
            stroked: true,
            filled: false,
            pickable: true,
            getLineColor: [130, 220, 255, opacity],
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 1.5,
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "keyline") {
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: layer.data as never,
            stroked: true,
            filled: true,
            pickable: true,
            getLineColor: (d: {
              properties?: { type?: string; status?: string };
            }) => {
              if (d.properties?.type === "GuideLine") return [255, 200, 40, 255];
              const status = d.properties?.status;
              if (status === "REVISAR") return [255, 196, 80, opacity];
              if (status === "AJUSTAR") return [255, 140, 50, opacity];
              if (status === "REDISENAR") return [255, 90, 80, opacity];
              return [140, 255, 120, opacity];
            },
            getLineWidth: (d: { properties?: { type?: string } }) =>
              d.properties?.type === "GuideLine" ? 3 : 2,
            getFillColor: (d: { properties?: { type?: string } }) => {
              if (d.properties?.type === "DrainBreak") return [80, 180, 255, 230];
              if (d.properties?.type === "Stakeout") return [255, 255, 255, 230];
              return [0, 0, 0, 0];
            },
            getPointRadius: (d: { properties?: { type?: string } }) =>
              d.properties?.type === "Stakeout" ? 3 : 5,
            pointRadiusUnits: "pixels",
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 1,
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "pipe") {
        const pipe = layer.data as PipeFeature;
        const path = pipe.vertices?.length >= 2 ? pipe.vertices : [pipe.source, pipe.target];
        result.push(
          new PathLayer({
            id: layer.id,
            data: [{ path, pipe }],
            getPath: ((d: { path: number[][] }) => d.path) as never,
            getColor: [255, 70, 70, opacity],
            getWidth: 4,
            widthUnits: "pixels",
            pickable: true,
          })
        );
      }

      if (layer.kind === "road") {
        const road = layer.data as RoadFeature;
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: road.geojson as never,
            stroked: true,
            filled: true,
            pickable: true,
            pointType: "circle",
            getLineColor: (d: { properties?: { kind?: string } }) =>
              d.properties?.kind === "over-grade"
                ? [255, 70, 70, 255]
                : [250, 190, 60, opacity],
            getLineWidth: (d: { properties?: { kind?: string } }) =>
              d.properties?.kind === "over-grade"
                ? Math.max(3, road.widthM * 0.7)
                : Math.max(2, road.widthM / 2),
            lineWidthUnits: "meters",
            lineWidthMinPixels: 2,
            getPointRadius: 5,
            pointRadiusUnits: "pixels",
            getFillColor: [80, 200, 255, 230],
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "fence") {
        const fence = layer.data as FenceFeature;
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: fence.geojson as never,
            stroked: true,
            filled: true,
            pickable: true,
            pointType: "circle",
            getLineColor: (d: { properties?: { kind?: string } }) =>
              d.properties?.kind === "steep"
                ? [220, 50, 50, 255]
                : [110, 180, 50, opacity],
            getLineWidth: (d: { properties?: { kind?: string } }) =>
              d.properties?.kind === "steep" ? 4 : Math.max(2, fence.rows * 2),
            lineWidthUnits: "pixels",
            lineWidthMinPixels: 2,
            getFillColor: [190, 230, 90, 230],
            getPointRadius: 3,
            pointRadiusUnits: "pixels",
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "sites") {
        result.push(
          new GeoJsonLayer({
            id: layer.id,
            data: layer.data as never,
            pickable: true,
            stroked: true,
            filled: true,
            pointType: "circle",
            getPointRadius: 8,
            pointRadiusUnits: "pixels",
            getFillColor: [60, 200, 170, 220],
            getLineColor: [255, 255, 255, 230],
            lineWidthMinPixels: 2,
            parameters: { depthTest: false },
          })
        );
      }

      if (layer.kind === "draw" || layer.kind === "measure") {
        const feat = layer.data as DrawFeature;
        if (feat.kind === "point") {
          result.push(
            new ScatterplotLayer({
              id: layer.id,
              data: [{ position: feat.coordinates[0] as [number, number] }],
              getPosition: (d: { position: [number, number] }) => d.position,
              getFillColor: [255, 220, 80, 230],
              getRadius: 6,
              radiusUnits: "pixels",
            })
          );
        } else if (feat.kind === "polygon") {
          result.push(
            new PolygonLayer({
              id: layer.id,
              data: [{ polygon: feat.coordinates }],
              getPolygon: (d: { polygon: number[][] }) => d.polygon,
              getFillColor: [80, 180, 255, 60],
              getLineColor: [80, 180, 255, 220],
              lineWidthMinPixels: 2,
              stroked: true,
              filled: true,
            })
          );
        } else {
          result.push(
            new PathLayer({
              id: layer.id,
              data: [{ path: feat.coordinates }],
              getPath: ((d: { path: number[][] }) => d.path) as never,
              getColor:
                feat.kind === "measure"
                  ? [255, 180, 40, 230]
                  : [180, 220, 255, 220],
              getWidth: 3,
              widthUnits: "pixels",
            })
          );
        }
      }
    }

    if (draft?.coords?.length) {
      result.push(
        new ScatterplotLayer({
          id: "draft-points",
          data: draft.coords.map((c) => ({
            position: c as [number, number],
          })),
          getPosition: (d: { position: [number, number] }) => d.position,
          getFillColor: [255, 255, 255, 230],
          getRadius: 5,
          radiusUnits: "pixels",
        })
      );
      if (draft.coords.length >= 2) {
        result.push(
          new PathLayer({
            id: "draft-path",
            data: [{ path: draft.coords }],
            getPath: ((d: { path: number[][] }) => d.path) as never,
            getColor: [255, 255, 255, 200],
            getWidth: 2,
            widthUnits: "pixels",
          })
        );
      }
    }

    return result;
  }, [layers, draft, showTerrain, viewState.pitch]);

  const mapStyle = BASEMAPS[basemap].style;

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={(e) => onViewStateChange(e.viewState as ViewState)}
      controller={true}
      layers={deckLayers}
      getCursor={() => (activeTool === "select" ? "grab" : "crosshair")}
      onHover={(info) => {
        if (info.coordinate) {
          onHoverMove(info.coordinate[0], info.coordinate[1]);
        }
        const props = (info.object as { properties?: Record<string, unknown> } | null)
          ?.properties;
        const elev = props?.elevation;
        if (typeof elev === "number") {
          onHoverFeature(
            `Curva ${Number.isInteger(elev) ? elev.toFixed(0) : elev.toFixed(2)} m`
          );
        } else if (props?.kind === "building-site") {
          onHoverFeature(
            `Sitio #${props.rank} · ${props.slope_pct}% · ${props.aspect} · ${props.pad_ha} ha`
          );
        } else if (props?.kind === "culvert") {
          onHoverFeature(`Alcantarilla #${props.index} · km ${props.chainage_m}`);
        } else if (props?.kind === "drain-break" || props?.type === "DrainBreak") {
          onHoverFeature("Corte en drenaje potencial");
        } else if (props?.kind === "stakeout" || props?.type === "Stakeout") {
          const z = typeof props.z === "number" ? `${props.z} m` : "sin cota";
          onHoverFeature(`Replanteo ${props.chain_m ?? "?"} m · ${z}`);
        } else if (props?.type === "Keyline") {
          const icl = props.icl != null ? `ICL ${props.icl}` : "";
          const slope =
            typeof props.slope_max === "number" ? `máx ${props.slope_max}%` : "";
          const bits = [props.status, icl, slope, props.review]
            .filter((x) => x !== undefined && x !== null && x !== "")
            .join(" · ");
          onHoverFeature(`Keyline #${props.index ?? "?"} · ${bits || "sin diagnóstico"}`);
        } else if (props?.type === "GuideLine") {
          onHoverFeature("Guía keyline");
        } else if (props?.kind === "dem-footprint") {
          onHoverFeature(
            `Límite del DEM · ${props.area_ha} ha · ${
              props.source === "mask" ? "celdas con dato" : "extensión del ráster"
            }`
          );
        } else if (props?.kind === "over-grade") {
          onHoverFeature(
            `Fuera de norma · ${props.grade_pct}% en ${props.length_m} m ` +
              `(tope ${props.limit_pct}%) · km ${props.chainage_m}`
          );
        } else if (props?.kind === "road") {
          const over =
            typeof props.over_grade_length_m === "number" && props.over_grade_length_m > 0
              ? ` · ${props.over_grade_length_m} m sobre ${props.limit_grade_pct}%`
              : "";
          onHoverFeature(`Camino ${props.length_m} m · máx ${props.max_grade_pct}%${over}`);
        } else if (props?.kind === "living-fence") {
          onHoverFeature(
            `Cerca ${props.species_name} · ${props.length_m} m · ${props.plant_count} plantas · máx ${props.max_grade_pct}%`
          );
        } else if (props?.kind === "steep") {
          onHoverFeature(
            `Pendiente ${props.grade_pct}% en ${props.length_m} m (tope ${props.limit_pct}%)`
          );
        } else if (props?.kind === "plant" || props?.type === "Plant") {
          const z = typeof props.z === "number" ? `${props.z} m` : "sin cota";
          onHoverFeature(`Planta ${props.chain_m ?? "?"} m · ${z}`);
        } else if (info.object && typeof info.object === "object" && "pipe" in info.object) {
          const p = (info.object as { pipe: PipeFeature }).pipe;
          onHoverFeature(
            `DN${p.dnMm ?? "?"} ${p.lengthM?.toFixed(0) ?? "?"} m · ${p.pressure} bar`
          );
        } else if (info.object && "pressure" in (info.object as object)) {
          const p = info.object as PipeFeature;
          onHoverFeature(`Tubería ${p.pressure} bar`);
        } else {
          onHoverFeature(null);
        }
      }}
      onClick={(info, event) => {
        if (!info.coordinate) return;
        const detail = (event?.srcEvent as MouseEvent | undefined)?.detail ?? 1;
        // Only native double-click finishes sketches (avoid 2nd vertex ending the line).
        onClick(info.coordinate[0], info.coordinate[1], detail > 1);
      }}
    >
      <MapGL mapStyle={mapStyle as never} />
    </DeckGL>
  );
}
