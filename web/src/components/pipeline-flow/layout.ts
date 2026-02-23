import type { Node, Edge } from "@xyflow/react";
import type { ElkExtendedEdge, ElkPort } from "elkjs/lib/elk.bundled.js";
import ELK from "elkjs/lib/elk.bundled.js";
import type { FieldNodeData } from "./types";
import {
  SCHEMA_NODE_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  DEST_NODE_WIDTH,
  DEST_NODE_HEIGHT,
} from "./types";

export function getVisibleHeight(data: FieldNodeData): number {
  const { fields, usedFields, keyPairs } = data;

  const pairCount = keyPairs?.length ?? 0;
  const pairedFieldNames = new Set(
    (keyPairs ?? []).flatMap((p) => [p.left, p.right]),
  );
  const regularFields = fields.filter((f) => !pairedFieldNames.has(f.name));

  const collapsible =
    usedFields &&
    usedFields.size > 0 &&
    regularFields.some((f) => !usedFields.has(f.name));
  const visibleRegularCount = collapsible
    ? regularFields.filter((f) => usedFields.has(f.name)).length
    : regularFields.length;

  const pairSectionHeight = pairCount * ROW_HEIGHT;
  const separatorHeight =
    pairCount > 0 && (visibleRegularCount > 0 || collapsible) ? 1 : 0;

  return (
    HEADER_HEIGHT +
    pairSectionHeight +
    separatorHeight +
    visibleRegularCount * ROW_HEIGHT +
    (collapsible ? ROW_HEIGHT : 0)
  );
}

export function buildPortsForFieldNode(
  nodeId: string,
  data: FieldNodeData,
): ElkPort[] {
  const { fields, usedFields, handleSide, dualHandleKeys, keyPairs } = data;
  const dualKeys = new Set(dualHandleKeys ?? []);
  const pairs = keyPairs ?? [];
  const pairedFieldNames = new Set(pairs.flatMap((p) => [p.left, p.right]));

  const regularFields = fields.filter((f) => !pairedFieldNames.has(f.name));
  const collapsible =
    usedFields &&
    usedFields.size > 0 &&
    regularFields.some((f) => !usedFields.has(f.name));
  const visibleRegular = collapsible
    ? regularFields.filter((f) => usedFields.has(f.name))
    : regularFields;

  const ports: ElkPort[] = [];
  const isRight = handleSide === "right";
  const isOutput = handleSide === "left";

  // Unified pair ports (1 handle per side per pair)
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;

    ports.push({
      id: `${nodeId}::dual-field-${pair.left}`,
      width: 1,
      height: 1,
      x: 0,
      y,
      layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
    });
    ports.push({
      id: `${nodeId}::field-${pair.left}`,
      width: 1,
      height: 1,
      x: SCHEMA_NODE_WIDTH,
      y,
      layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
    });
  }

  // Regular field ports
  const pairSectionHeight = pairs.length * ROW_HEIGHT;
  const separatorHeight =
    pairs.length > 0 && (visibleRegular.length > 0 || collapsible) ? 1 : 0;
  const regularOffset = HEADER_HEIGHT + pairSectionHeight + separatorHeight;

  for (let i = 0; i < visibleRegular.length; i++) {
    const field = visibleRegular[i];
    const y = regularOffset + i * ROW_HEIGHT + ROW_HEIGHT / 2;

    if (isRight) {
      ports.push({
        id: `${nodeId}::field-${field.name}`,
        width: 1,
        height: 1,
        x: SCHEMA_NODE_WIDTH,
        y,
        layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
      });
      if (dualKeys.has(field.name)) {
        ports.push({
          id: `${nodeId}::dual-field-${field.name}`,
          width: 1,
          height: 1,
          x: 0,
          y,
          layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
        });
      }
    } else {
      ports.push({
        id: `${nodeId}::field-${field.name}`,
        width: 1,
        height: 1,
        x: 0,
        y,
        layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
      });
    }
  }

  if (isOutput) {
    ports.push({
      id: `${nodeId}::dest`,
      width: 1,
      height: 1,
      x: SCHEMA_NODE_WIDTH,
      y: getVisibleHeight(data) / 2,
      layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
    });
  }

  return ports;
}

export function resolvePortId(
  nodeId: string,
  handleId: string | null | undefined,
  role: "source" | "target",
  nodeMap: Map<string, Node>,
): string {
  if (!handleId) return nodeId;

  if (role === "target" && handleId.startsWith("field-")) {
    const node = nodeMap.get(nodeId);
    if (node?.type === "field") {
      const dualKeys = new Set(
        (node.data as FieldNodeData).dualHandleKeys ?? [],
      );
      if (dualKeys.has(handleId.slice(6))) {
        return `${nodeId}::dual-${handleId}`;
      }
    }
  }

  return `${nodeId}::${handleId}`;
}

const elk = new ELK();

export async function layoutWithElk(
  nodes: Node[],
  edges: Edge[],
): Promise<Node[]> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const children = nodes.map((node) => {
    const isDest = node.type === "destination";
    const width = isDest ? DEST_NODE_WIDTH : SCHEMA_NODE_WIDTH;
    const height = isDest
      ? DEST_NODE_HEIGHT
      : getVisibleHeight(node.data as FieldNodeData);

    const ports = isDest
      ? [
          {
            id: `${node.id}::target`,
            width: 1,
            height: 1,
            x: 0,
            y: DEST_NODE_HEIGHT / 2,
            layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
          },
        ]
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
    sources: [
      resolvePortId(edge.source, edge.sourceHandle, "source", nodeMap),
    ],
    targets: [
      resolvePortId(edge.target, edge.targetHandle, "target", nodeMap),
    ],
  }));

  const graph = await elk.layout({
    id: "root",
    children,
    edges: elkEdges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "200",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    },
  });

  return nodes.map((node) => {
    const laid = graph.children?.find((c) => c.id === node.id);
    return laid
      ? { ...node, position: { x: laid.x ?? 0, y: laid.y ?? 0 } }
      : node;
  });
}
