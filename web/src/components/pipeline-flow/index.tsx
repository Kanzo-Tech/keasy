"use client";

import { useEffect, useCallback } from "react";
import {
  ReactFlow,
  Background,
  type ColorMode,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import { ZoomSelect } from "@/components/zoom-select";
import { cn } from "@/lib/utils";
import type { PipelineSummary } from "@/lib/types";
import { nodeTypes } from "./nodes";
import { buildPipelineGraph } from "./graph";
import { layoutWithElk } from "./layout";
import "@xyflow/react/dist/style.css";

interface PipelineFlowProps {
  pipeline: PipelineSummary;
  className?: string;
}

export function PipelineFlow({ pipeline, className }: PipelineFlowProps) {
  const { resolvedTheme } = useTheme();
  const colorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light";

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    let cancelled = false;
    const { nodes: raw, edges: rawEdges } = buildPipelineGraph(pipeline);
    layoutWithElk(raw, rawEdges).then((laid) => {
      if (cancelled) return;
      setNodes(laid);
      setEdges(rawEdges);
    });
    return () => {
      cancelled = true;
    };
  }, [pipeline, setNodes, setEdges]);

  const onInit = useCallback(
    (instance: { fitView: () => void }) => {
      instance.fitView();
    },
    [],
  );

  if (nodes.length === 0) {
    return (
      <div className={cn("rounded-lg border bg-background", className)} />
    );
  }

  return (
    <div className={cn("rounded-lg border bg-background", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        colorMode={colorMode}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable={false}
      >
        <Background gap={16} size={1} />
        <ZoomSelect position="top-left" />
      </ReactFlow>
    </div>
  );
}
