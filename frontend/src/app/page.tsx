"use client";

import { useEffect, useState } from "react";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { ClimatePanel } from "@/components/ClimatePanel";
import { LayerTree } from "@/components/LayerTree";
import { MapCanvas, type ViewState } from "@/components/MapCanvas";
import { SidePanel } from "@/components/SidePanel";
import { StatusBar } from "@/components/StatusBar";
import { ToolRail } from "@/components/ToolRail";
import { useProject } from "@/hooks/useProject";
import type { DemInfo } from "@/lib/types";

const INITIAL_VIEW: ViewState = {
  longitude: -84.0,
  latitude: 10.0,
  zoom: 12,
  maxZoom: 20,
  pitch: 45,
  bearing: 0,
};

function boundsRing(b: {
  left: number;
  bottom: number;
  right: number;
  top: number;
}): number[][] {
  return [
    [b.left, b.bottom],
    [b.right, b.bottom],
    [b.right, b.top],
    [b.left, b.top],
    [b.left, b.bottom],
  ];
}

export default function Home() {
  const {
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
    siteCount,
    saveProject,
    loadProject,
    pipes,
    roads,
    fences,
    boq,
    canUndo,
    canRedo,
  } = useProject();

  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW);
  const [treeTab, setTreeTab] = useState<"layers" | "surfaces">("layers");
  const [showTerrain, setShowTerrain] = useState(false);
  const [climateOpen, setClimateOpen] = useState(false);

  const climateSite = state.dem?.bounds
    ? {
        lon: (state.dem.bounds.left + state.dem.bounds.right) / 2,
        lat: (state.dem.bounds.bottom + state.dem.bounds.top) / 2,
        label: `Centro del DEM · ${state.dem.label}`,
        // Sin contorno guardado (proyecto viejo) sirve el rectángulo del DEM:
        // CHIRPS promedia sobre celdas de 5 km y no nota la diferencia.
        ring: state.dem.footprint?.ring ?? boundsRing(state.dem.bounds),
      }
    : {
        lon: viewState.longitude,
        lat: viewState.latitude,
        label: "Centro del mapa",
        ring: null,
      };

  // Centrar la cámara es una respuesta a la acción de cargar, no una
  // sincronización continua: por eso va en el manejador y no en un efecto.
  const focusDem = (dem: DemInfo | null) => {
    if (!dem?.bounds) return;
    const { left, right, bottom, top } = dem.bounds;
    const lon = (left + right) / 2;
    const lat = (bottom + top) / 2;
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      setViewState((vs) => ({ ...vs, longitude: lon, latitude: lat, zoom: 14 }));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishDraft();
      } else if (e.key === "Escape") {
        cancelDraft();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) dispatch({ type: "REDO" });
        else dispatch({ type: "UNDO" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft, cancelDraft, dispatch]);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="z-20 flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <SidePanel
          dem={state.dem}
          contourInterval={state.contourInterval}
          keylineOffsetM={state.keylineOffsetM}
          keylineCount={state.keylineCount}
          keylineMode={state.keylineMode}
          keylineFall={state.keylineFall}
          keylineStakeM={state.keylineStakeM}
          pipeDnMm={state.pipeDnMm}
          pipeFlowLs={state.pipeFlowLs}
          roadMaxGradePct={state.roadMaxGradePct}
          roadWidthM={state.roadWidthM}
          fenceSpecies={state.fenceSpecies}
          fenceSpacingM={state.fenceSpacingM}
          fenceRows={state.fenceRows}
          fencePurpose={state.fencePurpose}
          loading={state.loading}
          error={state.error}
          pipes={pipes}
          roads={roads}
          fences={fences}
          boq={boq}
          onPrice={(key, unitPrice) => dispatch({ type: "SET_PRICE", key, unitPrice })}
          onResetPrices={() => dispatch({ type: "RESET_PRICES" })}
          onInterval={applyContourInterval}
          onKeylineOffset={(v) =>
            dispatch({ type: "SET_KEYLINE_OFFSET", offset: v })
          }
          onKeylineCount={(v) => dispatch({ type: "SET_KEYLINE_COUNT", count: v })}
          onKeylineMode={(v) => dispatch({ type: "SET_KEYLINE_MODE", mode: v })}
          onKeylineFall={(v) => dispatch({ type: "SET_KEYLINE_FALL", fall: v })}
          onKeylineStake={(v) => dispatch({ type: "SET_KEYLINE_STAKE", stake: v })}
          onPipeDn={(v) => dispatch({ type: "SET_PIPE_DN", dn: v })}
          onPipeFlow={(v) => dispatch({ type: "SET_PIPE_FLOW", flow: v })}
          onRoadGrade={(v) => dispatch({ type: "SET_ROAD_GRADE", grade: v })}
          onRoadWidth={(v) => dispatch({ type: "SET_ROAD_WIDTH", width: v })}
          onFenceSpecies={(v) => dispatch({ type: "SET_FENCE_SPECIES", species: v })}
          onFenceSpacing={(v) => dispatch({ type: "SET_FENCE_SPACING", spacing: v })}
          onFenceRows={(v) => dispatch({ type: "SET_FENCE_ROWS", rows: v })}
          onFencePurpose={(v) => dispatch({ type: "SET_FENCE_PURPOSE", purpose: v })}
          onFencePerimeter={fencePerimeter}
          onUpload={async (file) => {
            const dem = await handleUpload(file);
            focusDem(dem);
            return dem;
          }}
          onClimate={() => setClimateOpen((open) => !open)}
          climateOpen={climateOpen}
          onSave={saveProject}
          onLoadLocal={() => focusDem(loadProject())}
          onLoadFile={(file) => {
            const reader = new FileReader();
            reader.onload = () => focusDem(loadProject(String(reader.result)));
            reader.readAsText(file);
          }}
        />
        <div className="min-h-0 flex-1">
          <LayerTree
            layers={state.layers}
            activeTab={treeTab}
            onTabChange={setTreeTab}
            onToggle={(id) => dispatch({ type: "TOGGLE_LAYER", id })}
            onOpacity={(id, opacity) =>
              dispatch({ type: "SET_OPACITY", id, opacity })
            }
          />
        </div>
        <div className="border-t border-zinc-800 p-2">
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={showTerrain}
              onChange={(e) => setShowTerrain(e.target.checked)}
              className="accent-emerald-500"
            />
            Hillshade / terrain (Terrarium)
          </label>
        </div>
      </aside>

      <main className="relative min-w-0 flex-1">
        <MapCanvas
          viewState={viewState}
          onViewStateChange={setViewState}
          layers={state.layers}
          draft={state.draft}
          activeTool={state.activeTool}
          basemap={state.basemap}
          showTerrain={showTerrain}
          onClick={(lon, lat, isDouble) => handleMapClick(lon, lat, isDouble)}
          onHoverMove={onPointerMove}
          onHoverFeature={(text) => dispatch({ type: "SET_HOVER", text })}
        />

        <div className="pointer-events-none absolute right-3 top-14 z-10">
          <AnalysisPanel
            hasDem={Boolean(state.dem)}
            loading={state.loading}
            resamplePct={state.resamplePct}
            gaussianSigma={state.gaussianSigma}
            slopeThreshold={state.slopeThreshold}
            smallestBasinHa={state.smallestBasinHa}
            pressureSource={state.pressureSource}
            legend={state.legend}
            legendTitle={state.legendTitle}
            overlay={state.activeOverlay}
            onResample={(v) => dispatch({ type: "SET_RESAMPLE", pct: v })}
            onGaussian={(v) => dispatch({ type: "SET_GAUSSIAN", sigma: v })}
            onSlopeThreshold={(v) =>
              dispatch({ type: "SET_SLOPE_THRESHOLD", value: v })
            }
            onBasin={(v) => dispatch({ type: "SET_BASIN", value: v })}
            onSurfaceMap={runSurfaceMap}
            onDamRebuild={runDamSuitability}
            onPressureTool={() => {
              if (state.pressureSource) rebuildPressure();
              else dispatch({ type: "SET_TOOL", tool: "pressure-field" });
            }}
            onParamsReleased={rebuildActiveOverlay}
            solarDay={state.solarDay}
            solarHour={state.solarHour}
            onSolarDay={(v) => dispatch({ type: "SET_SOLAR_DAY", day: v })}
            onSolarHour={(v) => dispatch({ type: "SET_SOLAR_HOUR", hour: v })}
            onSolarRebuild={runSolar}
            onSolarAnnual={runSolarAnnual}
            onSolarParamsReleased={() => {
              if (state.overlayId === "solar-annual") return;
              void rebuildActiveOverlay();
            }}
            onSoilMap={runSoilMap}
            siteMaxSlopePct={state.siteMaxSlopePct}
            sitePadM={state.sitePadM}
            onSiteSlope={(v) => dispatch({ type: "SET_SITE_SLOPE", slope: v })}
            onSitePad={(v) => dispatch({ type: "SET_SITE_PAD", pad: v })}
            onSitesRebuild={runBuildingSites}
            roadMaxGradePct={state.roadMaxGradePct}
            roadWidthM={state.roadWidthM}
            onRoadGrade={(v) => dispatch({ type: "SET_ROAD_GRADE", grade: v })}
            onRoadWidth={(v) => dispatch({ type: "SET_ROAD_WIDTH", width: v })}
            onRoadTool={() => dispatch({ type: "SET_TOOL", tool: "road" })}
            onConnectSites={connectSiteRoads}
            siteCount={siteCount}
          />
        </div>

        <div className="pointer-events-none absolute left-0 right-0 top-3 z-10 flex justify-center">
          <ToolRail
            activeTool={state.activeTool}
            onTool={(tool) => dispatch({ type: "SET_TOOL", tool })}
            onUndo={() => dispatch({ type: "UNDO" })}
            onRedo={() => dispatch({ type: "REDO" })}
            onClear={() => dispatch({ type: "CLEAR_ANALYSIS" })}
            canUndo={canUndo}
            canRedo={canRedo}
            hasDem={Boolean(state.dem)}
          />
        </div>

        {climateOpen && (
          <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-20">
            <ClimatePanel
              lat={climateSite.lat}
              lon={climateSite.lon}
              siteLabel={climateSite.label}
              ring={climateSite.ring}
              onClose={() => setClimateOpen(false)}
            />
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 z-10">
          <StatusBar
            lon={state.pointer?.lon ?? null}
            lat={state.pointer?.lat ?? null}
            elev={state.pointerElev}
            zoom={viewState.zoom}
            status={state.statusMessage}
            measure={state.measureLive}
            hoverInfo={state.hoverInfo}
            basemap={state.basemap}
            onBasemap={(basemap) => dispatch({ type: "SET_BASEMAP", basemap })}
          />
        </div>
      </main>
    </div>
  );
}
