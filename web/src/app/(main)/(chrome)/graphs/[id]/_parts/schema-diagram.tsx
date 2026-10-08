"use client";

import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  Background,
  BaseEdge,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { FormatNumber, Separator, useKanzoTheme } from "@kanzo-tech/ui";
import { settled } from "@/lib/api/settled";
import { corpusKey, ONCE, useCorpus } from "@/lib/fossil/corpus";
import {
  type EdgeTable,
  layoutSchema,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Point,
  type VertexType,
} from "./schema-layout";
import "@xyflow/react/dist/style.css";

type TypeNode = Node<VertexType, "type">;
type RoutedEdge = Edge<{ route: Point[]; label: Point }, "routed">;

/** The pipeline flow's node card: a muted header over its rows. Its handles are only where edges attach. */
function TypeCard({ data }: NodeProps<TypeNode>) {
  return (
    <div className="relative rounded-md border bg-card text-card-foreground" style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}>
      <header className="truncate rounded-t-md bg-secondary px-3 py-2 text-center text-muted-foreground text-sm">
        {data.name}
      </header>
      <Separator />
      <div className="px-3 py-1.5 text-xs">
        <FormatNumber value={data.rows} /> vertices
      </div>
      <Handle className="invisible" isConnectable={false} position={Position.Left} type="target" />
      <Handle className="invisible" isConnectable={false} position={Position.Right} type="source" />
    </div>
  );
}

/** An edge table along the route ELK drew, named at the point ELK left for its name. */
function RoutedLine({ data, label, markerEnd }: EdgeProps<RoutedEdge>) {
  const [start, ...rest] = data?.route ?? [];
  if (!start) return null;
  const path = `M ${start.x} ${start.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(" ")}`;
  return (
    <BaseEdge
      label={label}
      labelBgPadding={[4, 2]}
      labelStyle={{ fontSize: 11 }}
      labelX={data?.label.x}
      labelY={data?.label.y}
      markerEnd={markerEnd}
      path={path}
    />
  );
}

const nodeTypes = { type: TypeCard };
const edgeTypes = { routed: RoutedLine };

/**
 * The corpus's schema: each vertex type a card with its count, each edge table a line from the type
 * its `source` references to the one its `destination` does — `fossil.json`'s endpoints, laid out by
 * ELK. Read-only: nothing here is the program's to change.
 */
export function SchemaDiagram({ types, edges }: { types: VertexType[]; edges: EdgeTable[] }) {
  const { appearance } = useKanzoTheme();
  const { graphId } = useCorpus();
  const laid = settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "schema-layout"],
      queryFn: () => layoutSchema(types, edges),
      ...ONCE,
    }),
  );

  const flow = useMemo(
    () => ({
        nodes: laid.nodes.map<TypeNode>(({ x, y, ...type }) => ({
          id: type.name,
          type: "type",
          position: { x, y },
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          data: type,
        })),
        edges: laid.edges.map<RoutedEdge>((e) => ({
          id: e.name,
          type: "routed",
          source: e.source,
          target: e.destination,
          label: e.name,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { route: e.route, label: e.label },
        })),
    }),
    [laid],
  );

  return (
    <div className="h-72 overflow-hidden rounded-lg border bg-background">
      <ReactFlow
        colorMode={appearance}
        edgeTypes={edgeTypes}
        edges={flow.edges}
        edgesFocusable={false}
        fitView
        nodeTypes={nodeTypes}
        nodes={flow.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        zoomOnScroll={false}
      >
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
