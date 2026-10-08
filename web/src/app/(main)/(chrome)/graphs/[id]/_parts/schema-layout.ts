import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

/** A vertex type of the corpus: one `fossil_tables` row of kind `vertex`. */
export type VertexType = {
  name: string;
  rows: number;
};

/** An edge table of the corpus: its `source` and `destination` are the vertex tables it joins. */
export interface EdgeTable {
  name: string;
  rows: number;
  source: string;
  destination: string;
}

export interface Point {
  x: number;
  y: number;
}

/** Where ELK put each type, and the route and label point of each edge table between them. */
export interface SchemaLayout {
  nodes: (VertexType & Point)[];
  edges: (EdgeTable & { route: Point[]; label: Point })[];
}

/** The card a type is drawn in (the pipeline flow's node card): a header and one row. */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 66;

/** ELK sizes a label before it places it; this is the label's text at the diagram's `text-xs`. */
const labelSize = (text: string) => ({ width: text.length * 6.5 + 8, height: 16 });

const elk = new ELK();

/**
 * The schema laid out left to right, ELK's layered algorithm with orthogonal routes: each edge table
 * keeps the route ELK drew for it, so two tables between one pair of types are two lines, not one.
 */
export async function layoutSchema(types: VertexType[], edges: EdgeTable[]): Promise<SchemaLayout> {
  const graph: ElkNode = {
    id: "schema",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.edgeLabels.placement": "CENTER",
    },
    children: types.map((t) => ({ id: t.name, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((e) => ({
      id: e.name,
      sources: [e.source],
      targets: [e.destination],
      labels: [{ text: e.name, ...labelSize(e.name) }],
    })),
  };
  const laid = await elk.layout(graph);
  const at = new Map(laid.children?.map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  const routed = new Map(laid.edges?.map((e) => [e.id, e]));
  return {
    nodes: types.map((t) => ({ ...t, ...(at.get(t.name) ?? { x: 0, y: 0 }) })),
    edges: edges.map((e) => {
      const { sections = [], labels = [] } = routed.get(e.name) ?? {};
      const route = sections.flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]);
      const [text] = labels;
      const label = text
        ? { x: (text.x ?? 0) + (text.width ?? 0) / 2, y: (text.y ?? 0) + (text.height ?? 0) / 2 }
        : (route[Math.floor(route.length / 2)] ?? { x: 0, y: 0 });
      return { ...e, route, label };
    }),
  };
}
