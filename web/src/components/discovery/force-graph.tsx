"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  getNodeRadius,
  getLiteralBox,
  getGraphScale,
  drawNode,
  drawLink,
  buildNodeTooltip,
} from "@/lib/graph-rendering";
import { usePreferences } from "@/components/preferences-provider";
import type { GraphData, GraphNode } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface ForceGraphProps {
  data: GraphData;
  selectedId?: string;
  onNodeClick?: (node: GraphNode) => void;
}

export function ForceGraph({
  data,
  selectedId,
  onNodeClick,
}: ForceGraphProps) {
  const { preferences } = usePreferences();
  const scale = useMemo(
    () => getGraphScale(preferences.font_size),
    [preferences.font_size],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(500);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setWidth(Math.floor(entry.contentRect.width));
      setHeight(Math.floor(entry.contentRect.height));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (data && data.nodes.length > 0) {
      const timer = setTimeout(() => {
        graphRef.current?.zoomToFit(400, 60);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [data]);

  const nodeCanvasObject = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      drawNode(node, ctx, globalScale, selectedId, scale);
    },
    [selectedId, scale],
  );

  const linkCanvasObject = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      drawLink(link, ctx, globalScale, scale);
    },
    [scale],
  );

  const nodeTooltip = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (node: any): string => buildNodeTooltip(node),
    [],
  );

  const canvasHeight = Math.max(height, 200);

  const drawDotGrid = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const GAP = 24;
      const DOT_RADIUS = 0.35;

      const { a, d, e, f } = ctx.getTransform();
      const left = -e / a;
      const top = -f / d;
      const right = (width - e) / a;
      const bottom = (canvasHeight - f) / d;

      // Skip if zoomed out too far (performance guard)
      const cols = (right - left) / GAP;
      const rows = (bottom - top) / GAP;
      if (cols * rows > 15000) return;

      const startX = Math.floor(left / GAP) * GAP;
      const startY = Math.floor(top / GAP) * GAP;

      const isDark = document.documentElement.classList.contains("dark");
      ctx.fillStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";

      ctx.beginPath();
      for (let x = startX; x <= right; x += GAP) {
        for (let y = startY; y <= bottom; y += GAP) {
          ctx.moveTo(x + DOT_RADIUS, y);
          ctx.arc(x, y, DOT_RADIUS, 0, 2 * Math.PI);
        }
      }
      ctx.fill();
    },
    [width, canvasHeight],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 rounded-md border border-border overflow-hidden bg-background flex flex-col"
    >
      <ForceGraph2D
        ref={graphRef}
        graphData={data}
        width={width}
        height={canvasHeight}
        backgroundColor="transparent"
        onRenderFramePre={drawDotGrid}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          node: any,
          color: string,
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => {
          if (node.group === "literal") {
            const { boxW, boxH, cornerR } = getLiteralBox(node, ctx, globalScale, scale);
            ctx.beginPath();
            ctx.roundRect((node.x ?? 0) - boxW / 2, (node.y ?? 0) - boxH / 2, boxW, boxH, cornerR);
          } else {
            const radius = getNodeRadius(node.group, globalScale, scale);
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
          }
          ctx.fillStyle = color;
          ctx.fill();
        }}
        nodeLabel={nodeTooltip}
        linkCanvasObject={linkCanvasObject}
        cooldownTicks={100}
        onNodeClick={
          onNodeClick
            ? (node) => onNodeClick(node as unknown as GraphNode)
            : () => graphRef.current?.zoomToFit(400, 60)
        }
      />
    </div>
  );
}
