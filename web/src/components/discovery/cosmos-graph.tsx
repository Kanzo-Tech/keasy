/**
 * CosmosGraph — React wrapper for @cosmos.gl/graph.
 *
 * cosmos.gl creates a WebGL canvas inside a container div and manages
 * its own ResizeObserver. This component handles lifecycle (create/destroy),
 * data updates, tooltip rendering, and exposes the Graph instance via ref.
 */

"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Graph, type GraphConfigInterface } from "@cosmos.gl/graph";
import { createPortal } from "react-dom";

export interface CosmosGraphProps {
  config: GraphConfigInterface;
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;
  linkIndexes?: Float32Array;
  pointClusters?: (number | undefined)[];
  clusterPositions?: (number | undefined)[];
  focusedPointIndex?: number;
  renderPointTooltip?: (index: number) => ReactNode;
}

/** Imperative handle exposing cosmos.gl Graph methods to parent components. */
export interface CosmosGraphHandle {
  graph: Graph | null;
  zoomIn: (duration?: number) => void;
  zoomOut: (duration?: number) => void;
  fitView: (duration?: number) => void;
  start: () => void;
  pause: () => void;
  selectPointsByIndices: (indices: (number | undefined)[]) => void;
  unselectPoints: () => void;
}

export const CosmosGraph = forwardRef<CosmosGraphHandle, CosmosGraphProps>(
  function CosmosGraph(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<Graph | null>(null);
    const [tooltip, setTooltip] = useState<{
      index: number;
      x: number;
      y: number;
    } | null>(null);
    const [webglError, setWebglError] = useState(false);

    // Expose typed handle to parent
    useImperativeHandle(ref, () => ({
      get graph() { return graphRef.current; },
      zoomIn: (duration = 300) => {
        const g = graphRef.current;
        if (g) g.zoom(g.getZoomLevel() * 1.5, duration);
      },
      zoomOut: (duration = 300) => {
        const g = graphRef.current;
        if (g) g.zoom(g.getZoomLevel() / 1.5, duration);
      },
      fitView: (duration?: number) => graphRef.current?.fitView(duration),
      start: () => graphRef.current?.start(),
      pause: () => graphRef.current?.pause(),
      selectPointsByIndices: (indices: (number | undefined)[]) => graphRef.current?.selectPointsByIndices(indices),
      unselectPoints: () => graphRef.current?.selectPointsByIndices(null),
    }), []);

    // Create graph on mount
    useEffect(() => {
      if (!containerRef.current) return;
      let graph: Graph;
      try {
        graph = new Graph(containerRef.current, {
        ...props.config,
        onPointMouseOver: (index: number, _pos: [number, number], event: unknown) => {
          const e = event as MouseEvent | undefined;
          if (props.renderPointTooltip && index !== undefined && e) {
            setTooltip({
              index,
              x: e.clientX,
              y: e.clientY,
            });
          }
        },
        onPointMouseOut: () => setTooltip(null),
      });
      graphRef.current = graph;
      } catch {
        setWebglError(true);
        return;
      }
      return () => {
        graph.destroy();
        graphRef.current = null;
      };
      // Only run on mount/unmount — config changes handled by setConfig below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update config (simulation, visual, events)
    useEffect(() => {
      graphRef.current?.setConfig(props.config);
    }, [props.config]);

    // Update point data
    useEffect(() => {
      const g = graphRef.current;
      if (!g) return;
      g.setPointPositions(props.pointPositions);
      g.setPointColors(props.pointColors);
      g.setPointSizes(props.pointSizes);
      if (props.linkIndexes) g.setLinks(props.linkIndexes);
      if (props.pointClusters) g.setPointClusters(props.pointClusters);
      if (props.clusterPositions) g.setClusterPositions(props.clusterPositions);
      g.render();
    }, [
      props.pointPositions,
      props.pointColors,
      props.pointSizes,
      props.linkIndexes,
      props.pointClusters,
      props.clusterPositions,
    ]);

    // Focused point
    useEffect(() => {
      graphRef.current?.setConfig({
        focusedPointIndex: props.focusedPointIndex,
      });
    }, [props.focusedPointIndex]);

    if (webglError) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-sm text-destructive font-medium">WebGL not available</p>
            <p className="text-xs text-muted-foreground">Your browser or GPU does not support WebGL, which is required for graph visualization.</p>
            <button className="text-xs text-primary underline" onClick={() => { setWebglError(false); }}>Retry</button>
          </div>
        </div>
      );
    }

    return (
      <>
        <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        {tooltip &&
          props.renderPointTooltip &&
          createPortal(
            <div
              className="pointer-events-none fixed z-50 rounded-md border bg-popover px-2 py-1 shadow-md"
              style={{
                left: tooltip.x + 12,
                top: tooltip.y + 12,
              }}
            >
              {props.renderPointTooltip(tooltip.index)}
            </div>,
            document.body,
          )}
      </>
    );
  },
);
