"use client";

import { useEffect, useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Position,
  type ColorMode,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import ELK, { type ElkExtendedEdge, type ElkPort } from "elkjs/lib/elk.bundled.js";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BaseNode, BaseNodeHeader } from "@/components/base-node";
import { BaseHandle } from "@/components/base-handle";
import { ZoomSelect } from "@/components/zoom-select";
import { cn } from "@/lib/utils";
import type { PipelineSummary, Field } from "@/lib/types";
import "@xyflow/react/dist/style.css";

type FieldNodeData = {
  label: string;
  fields: Field[];
  handleSide: "left" | "right";
  variant?: "operation";
  dualHandleKeys?: string[];
  usedFields?: Set<string>;
};

function FieldNode({ data }: NodeProps<Node<FieldNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const pos = data.handleSide === "right" ? Position.Right : Position.Left;
  const handleType = data.handleSide === "right" ? "source" : "target";
  const isOutput = data.handleSide === "left";
  const dualKeys = new Set(data.dualHandleKeys ?? []);
  const dualPos = pos === Position.Right ? Position.Left : Position.Right;
  const dualType = handleType === "source" ? "target" : "source";

  const { usedFields } = data;
  const collapsible = usedFields && usedFields.size > 0 && usedFields.size < data.fields.length;
  const visibleFields = expanded || !collapsible
    ? data.fields
    : data.fields.filter((f) => usedFields.has(f.name));
  const hiddenCount = collapsible && !expanded ? data.fields.length - visibleFields.length : 0;

  return (
    <BaseNode className="min-w-[200px]">
      <BaseNodeHeader className="rounded-tl-md rounded-tr-md bg-secondary p-2 text-center text-sm text-muted-foreground">
        {data.variant === "operation" ? (
          <Badge variant="outline" className="text-[10px] w-fit border-primary/50">
            {data.label}
          </Badge>
        ) : (
          <h2>{data.label}</h2>
        )}
      </BaseNodeHeader>
      <Separator />
      <div className="flex flex-col divide-y overflow-visible">
        {visibleFields.map((field) => (
          <div key={field.name} className="relative flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
            <BaseHandle type={handleType} position={pos} id={`field-${field.name}`} />
            {dualKeys.has(field.name) && (
              <BaseHandle type={dualType} position={dualPos} id={`field-${field.name}`} />
            )}
            <span className="font-mono truncate min-w-0">{field.name}</span>
            <span className="text-muted-foreground font-mono shrink-0">
              {field.type}
            </span>
          </div>
        ))}
        {hiddenCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(true)}
            className="h-auto rounded-none px-3 py-1.5 text-xs text-muted-foreground justify-start"
          >
            + {hiddenCount} more fields
          </Button>
        )}
        {expanded && collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(false)}
            className="h-auto rounded-none px-3 py-1.5 text-xs text-muted-foreground justify-start"
          >
            Show less
          </Button>
        )}
      </div>
      {isOutput && <BaseHandle type="source" position={Position.Right} id="dest" />}
    </BaseNode>
  );
}

function DestinationNode({ data }: NodeProps<Node<{ url: string }>>) {
  return (
    <BaseNode>
      <BaseHandle type="target" position={Position.Left} id="target" />
      <div className="flex items-center gap-2 px-3 py-2">
        <Upload size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">
          {data.url}
        </span>
      </div>
    </BaseNode>
  );
}

const nodeTypes: NodeTypes = { field: FieldNode, destination: DestinationNode };

const SCHEMA_NODE_WIDTH = 240;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 28;
const DEST_NODE_WIDTH = 280;
const DEST_NODE_HEIGHT = 40;

function computeUsedFields(edges: Edge[]): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [nodeId, handle] of [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ] as const) {
      if (!handle?.startsWith("field-")) continue;
      if (!used.has(nodeId)) used.set(nodeId, new Set());
      used.get(nodeId)!.add(handle.slice(6));
    }
  }
  return used;
}

function getVisibleHeight(data: FieldNodeData): number {
  const { fields, usedFields } = data;
  const collapsible = usedFields && usedFields.size > 0 && usedFields.size < fields.length;
  const visibleCount = collapsible ? usedFields.size : fields.length;
  return HEADER_HEIGHT + visibleCount * ROW_HEIGHT + (collapsible ? ROW_HEIGHT : 0);
}

function buildPortsForFieldNode(nodeId: string, data: FieldNodeData): ElkPort[] {
  const { fields, usedFields, handleSide, dualHandleKeys } = data;
  const dualKeys = new Set(dualHandleKeys ?? []);
  const collapsible = usedFields && usedFields.size > 0 && usedFields.size < fields.length;
  const visibleFields = collapsible
    ? fields.filter((f) => usedFields.has(f.name))
    : fields;

  const ports: ElkPort[] = [];
  const isRight = handleSide === "right";
  const isOutput = handleSide === "left";

  for (let i = 0; i < visibleFields.length; i++) {
    const field = visibleFields[i];
    const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;

    if (isRight) {
      ports.push({
        id: `${nodeId}::field-${field.name}`,
        width: 1, height: 1, x: SCHEMA_NODE_WIDTH, y,
        layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
      });
      if (dualKeys.has(field.name)) {
        ports.push({
          id: `${nodeId}::dual-field-${field.name}`,
          width: 1, height: 1, x: 0, y,
          layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
        });
      }
    } else {
      ports.push({
        id: `${nodeId}::field-${field.name}`,
        width: 1, height: 1, x: 0, y,
        layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
      });
    }
  }

  if (isOutput) {
    ports.push({
      id: `${nodeId}::dest`,
      width: 1, height: 1,
      x: SCHEMA_NODE_WIDTH, y: getVisibleHeight(data) / 2,
      layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
    });
  }

  return ports;
}

function resolvePortId(
  nodeId: string,
  handleId: string | null | undefined,
  role: "source" | "target",
  nodeMap: Map<string, Node>,
): string {
  if (!handleId) return nodeId;

  if (role === "target" && handleId.startsWith("field-")) {
    const node = nodeMap.get(nodeId);
    if (node?.type === "field") {
      const dualKeys = new Set((node.data as FieldNodeData).dualHandleKeys ?? []);
      if (dualKeys.has(handleId.slice(6))) {
        return `${nodeId}::dual-${handleId}`;
      }
    }
  }

  return `${nodeId}::${handleId}`;
}

const elk = new ELK();

async function layoutWithElk(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const children = nodes.map((node) => {
    const isDest = node.type === "destination";
    const width = isDest ? DEST_NODE_WIDTH : SCHEMA_NODE_WIDTH;
    const height = isDest ? DEST_NODE_HEIGHT : getVisibleHeight(node.data as FieldNodeData);

    const ports = isDest
      ? [{
          id: `${node.id}::target`,
          width: 1, height: 1,
          x: 0, y: DEST_NODE_HEIGHT / 2,
          layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
        }]
      : buildPortsForFieldNode(node.id, node.data as FieldNodeData);

    return {
      id: node.id,
      width,
      height,
      ports,
      layoutOptions: { "org.eclipse.elk.portConstraints": "FIXED_POS" },
    };
  });

  const elkEdges: ElkExtendedEdge[] = edges.map((edge) => ({
    id: edge.id,
    sources: [resolvePortId(edge.source, edge.sourceHandle, "source", nodeMap)],
    targets: [resolvePortId(edge.target, edge.targetHandle, "target", nodeMap)],
  }));

  const graph = await elk.layout({
    id: "root",
    children,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
  });

  return nodes.map((node) => {
    const laid = graph.children?.find((c) => c.id === node.id);
    return laid ? { ...node, position: { x: laid.x ?? 0, y: laid.y ?? 0 } } : node;
  });
}

function buildPipelineGraph(pipeline: PipelineSummary): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const inputIds = new Map<string, string>();

  for (const input of pipeline.inputs) {
    const id = `input-${input.name}`;
    inputIds.set(input.name, id);
    nodes.push({ id, type: "field", position: { x: 0, y: 0 }, data: { label: input.name, fields: input.fields, handleSide: "right" } });
  }

  for (let i = 0; i < pipeline.operations.length; i++) {
    const op = pipeline.operations[i];
    nodes.push({ id: `op-${i}`, type: "field", position: { x: 0, y: 0 }, data: { label: op.label, fields: op.fields, handleSide: "right", variant: "operation", dualHandleKeys: op.inputs.flatMap((inp) => inp.key_fields) } });
  }

  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    nodes.push({ id: `out-${i}-${out.type_name}`, type: "field", position: { x: 0, y: 0 }, data: { label: out.type_name, fields: out.fields, handleSide: "left" } });
  }

  const destMap = new Map<string, string[]>();
  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    if (out.destination) {
      const outId = `out-${i}-${out.type_name}`;
      const list = destMap.get(out.destination) ?? [];
      list.push(outId);
      destMap.set(out.destination, list);
    }
  }

  let destIdx = 0;
  for (const [url, outIds] of destMap) {
    const destId = `dest-${destIdx++}`;
    nodes.push({ id: destId, type: "destination", position: { x: 0, y: 0 }, data: { url } });
    for (const outId of outIds) {
      edges.push({ id: `e-${outId}-${destId}`, source: outId, sourceHandle: "dest", target: destId, targetHandle: "target", animated: true });
    }
  }

  const prevOpInChain = new Map<string, string>();
  for (let i = 0; i < pipeline.operations.length; i++) {
    const op = pipeline.operations[i];
    const opId = `op-${i}`;
    for (const input of op.inputs) {
      const sourceNodeId = prevOpInChain.get(input.source) ?? inputIds.get(input.source);
      if (!sourceNodeId) continue;
      for (const field of input.key_fields) {
        edges.push({ id: `e-${sourceNodeId}-${field}-${opId}`, source: sourceNodeId, sourceHandle: `field-${field}`, target: opId, targetHandle: `field-${field}`, animated: true });
      }
    }
    if (op.inputs.length > 0) prevOpInChain.set(op.inputs[0].source, opId);
  }

  function resolveSourceNode(source: string): { nodeId: string; fields: Field[] } | null {
    let lastOp: { nodeId: string; fields: Field[] } | null = null;
    for (let i = 0; i < pipeline.operations.length; i++) {
      const op = pipeline.operations[i];
      if (op.inputs.some((inp) => inp.source === source)) lastOp = { nodeId: `op-${i}`, fields: op.fields };
    }
    if (lastOp) return lastOp;
    const srcId = inputIds.get(source);
    if (srcId) {
      const srcInput = pipeline.inputs.find((inp) => inp.name === source);
      if (srcInput) return { nodeId: srcId, fields: srcInput.fields };
    }
    return null;
  }

  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    const outId = `out-${i}-${out.type_name}`;
    if (!out.source) continue;
    const resolved = resolveSourceNode(out.source);
    if (!resolved) continue;
    const { nodeId: sourceNodeId, fields: sourceFields } = resolved;
    const srcFieldSet = new Set(sourceFields.map((f) => f.name));
    const outFieldSet = new Set(out.fields.map((f) => f.name));
    for (const m of out.mappings ?? []) {
      const srcField = srcFieldSet.has(m.source) ? m.source : null;
      if (srcField && outFieldSet.has(m.target)) {
        edges.push({ id: `ef-${sourceNodeId}-${srcField}-${outId}-${m.target}`, source: sourceNodeId, sourceHandle: `field-${srcField}`, target: outId, targetHandle: `field-${m.target}`, animated: true });
      }
    }
  }

  // Compute used fields
  const usedFieldsMap = computeUsedFields(edges);
  for (const node of nodes) {
    if (node.type === "field") (node.data as FieldNodeData).usedFields = usedFieldsMap.get(node.id);
  }

  return { nodes, edges };
}

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
    return () => { cancelled = true; };
  }, [pipeline, setNodes, setEdges]);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    instance.fitView();
  }, []);

  if (nodes.length === 0) {
    return <div className={cn("rounded-lg border bg-background", className)} />;
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
