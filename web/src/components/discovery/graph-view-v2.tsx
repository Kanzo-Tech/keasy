/**
 * GraphCanvas — Clean canvas with graph + legend overlay.
 * Search, floating controls, and panels live outside this component.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Network } from "lucide-react";
import { CosmosGraph, type CosmosGraphHandle } from "./cosmos-graph";
import type { GraphConfigInterface } from "@cosmos.gl/graph";
import type { Selection } from "@uwdata/mosaic-core";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { EmptyState } from "@/components/shared/empty-state";
import type { GraphSchema } from "@/lib/graph-schema";
import { useGraphData, GROUP_CSS_COLORS } from "./use-graph-data";
import { useGraphCrossfilter } from "./use-graph-crossfilter";

// ── Adaptive config (continuous scaling, no breakpoints) ─────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);

/** t = 0 at ~10 nodes, t = 1 at ~100k nodes (log10 scale) */
function graphScale(n: number): number {
  return clamp((Math.log10(Math.max(n, 1)) - 1) / 4, 0, 1);
}

/** Simulation params that scale continuously with node count. */
export function getAdaptiveConfig(nodeCount: number): GraphConfigInterface {
  const t = graphScale(nodeCount);
  return {
    // Visual (constant)
    backgroundColor: "transparent",
    enableDrag: true,
    fitViewOnInit: false,
    pointGreyoutOpacity: 0.3,
    linkGreyoutOpacity: 0.1,
    simulationLinkDistRandomVariationRange: [1, 1.3],

    // Adaptive simulation
    spaceSize:               lerp(2048, 8192, t),
    simulationRepulsion:     lerp(1.2, 0.4, t),
    simulationFriction:      lerp(0.7, 0.92, t),
    simulationLinkSpring:    lerp(0.5, 0.25, t),
    simulationLinkDistance:  lerp(30, 12, t),
    simulationGravity:       lerp(0.35, 0.08, t),
    simulationDecay:         lerp(800, 2500, t),
    simulationCluster:       0.15,
    simulationCenter:        lerp(0.1, 0.02, t),

    // Adaptive rendering
    pointSizeScale:          lerp(1.5, 0.5, t),
    renderLinks:             nodeCount < 250_000,
    scalePointsOnZoom:       nodeCount < 100_000,
    renderHoveredPointRing:  nodeCount < 100_000,
    ...(nodeCount > 5000 && {
      linkVisibilityDistanceRange: [50, 200],
      linkVisibilityMinTransparency: 0.05,
    }),
  };
}

/** Backwards-compatible export for components that need a static default. */
export const DEFAULT_GRAPH_CONFIG: GraphConfigInterface = getAdaptiveConfig(500);

// ── Props ────────────────────────────────────────────────────────────────

interface Props {
  schema: GraphSchema;
  graphConfig: GraphConfigInterface;
  graphRef: React.RefObject<CosmosGraphHandle | null>;
  selection: Selection;
  onSelectVertex: (vertex: { id: string; type: string; label: string } | null) => void;
}

// ── Component ────────────────────────────────────────────────────────────

export function GraphCanvas({ schema, graphConfig, graphRef, selection, onSelectVertex }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [simulationRunning, setSimulationRunning] = useState(true);

  const graphData = useGraphData(schema);
  const { publishSelection, clearSelection } = useGraphCrossfilter(graphData, graphRef.current?.graph ?? null, selection);

  // Pause on visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) graphRef.current?.pause();
      else graphRef.current?.start();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [graphRef]);

  // Keyboard: F = fit, Space = play/pause
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "f" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); graphRef.current?.fitView(500); }
      if (e.key === " " && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (simulationRunning) graphRef.current?.pause(); else graphRef.current?.start(); setSimulationRunning((p) => !p); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graphRef, simulationRunning]);

  // Config: adaptive base + user overrides + event handlers
  const nodeCount = graphData?.ids.length ?? 0;
  const config = useMemo((): GraphConfigInterface => ({
    ...getAdaptiveConfig(nodeCount),
    ...graphConfig,
    onClick: (index: number | undefined) => {
      setSelectedIndex(index ?? null);
      if (index != null && graphData) {
        publishSelection([index]);
        onSelectVertex({ id: graphData.ids[index], type: graphData.types[index], label: graphData.labels[index] });
      } else {
        clearSelection();
        onSelectVertex(null);
      }
    },
    onSimulationEnd: () => {
      setSimulationRunning(false);
      graphRef.current?.fitView(500);
    },
  }), [graphConfig, nodeCount, graphData, publishSelection, clearSelection, onSelectVertex, graphRef]);

  // Group toggle
  const toggleGroup = useCallback((name: string) => {
    setHiddenGroups((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  const visibleData = useMemo(() => {
    if (!graphData || hiddenGroups.size === 0) return graphData;
    const colors = new Float32Array(graphData.pointColors);
    const sizes = new Float32Array(graphData.pointSizes);
    for (let i = 0; i < graphData.types.length; i++) {
      if (hiddenGroups.has(graphData.types[i])) { colors[i * 4 + 3] = 0; sizes[i] = 0; }
    }
    return { ...graphData, pointColors: colors, pointSizes: sizes };
  }, [graphData, hiddenGroups]);

  const groupEntries = useMemo(() => {
    if (!graphData) return [];
    const counts = new Map<string, number>();
    for (const t of graphData.types) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([name, count], i) => ({
      name, count, color: GROUP_CSS_COLORS[i % GROUP_CSS_COLORS.length],
    }));
  }, [graphData]);

  if (graphData === null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!visibleData || visibleData.ids.length === 0) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <EmptyState icon={Network} title="Knowledge graph" description="No data available for visualization." />
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <CosmosGraph
        ref={graphRef}
        config={config}
        pointPositions={visibleData.pointPositions}
        pointColors={visibleData.pointColors}
        pointSizes={visibleData.pointSizes}
        linkIndexes={visibleData.linkIndexes}
        pointClusters={visibleData.pointClusters}
        clusterPositions={visibleData.clusterPositions}
        focusedPointIndex={selectedIndex ?? undefined}
        renderPointTooltip={(i) => (
          <div className="text-xs"><p className="font-medium">{visibleData.labels[i]}</p><p className="text-muted-foreground">{visibleData.types[i]}</p></div>
        )}
      />

      {/* Legend — bottom left */}
      {groupEntries.length > 1 && (
        <div className="absolute bottom-3 left-3 bg-card/90 backdrop-blur-sm border rounded-sm p-0.5 text-xs space-y-0 select-none z-10">
          {groupEntries.map(({ name, count, color }) => (
            <Toggle key={name} size="sm" pressed={!hiddenGroups.has(name)} onPressedChange={() => toggleGroup(name)} className="flex items-center gap-1.5 w-full justify-start h-5 px-1.5 text-xs rounded-sm">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="truncate">{name}</span>
              <Badge variant="secondary" className="ml-auto text-[9px] px-1 py-0 leading-tight h-3.5 min-w-0">{count.toLocaleString()}</Badge>
            </Toggle>
          ))}
        </div>
      )}
    </div>
  );
}
