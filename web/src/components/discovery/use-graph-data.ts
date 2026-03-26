/**
 * useGraphData — GraphAr → DuckDB → Float32Array → cosmos.gl
 *
 * Zero-copy where possible:
 * - Edge source/target from GraphAr are INT indices — no JOINs, no string lookups
 * - Strings (subject, labels) materialize (inevitable)
 *
 * Queries go to lazy DuckDB views over remote Parquet (httpfs).
 * DuckDB only transfers the 4 needed columns via HTTP Range requests.
 */

"use client";

import { useMemo } from "react";
import { useCoordinatorQuery } from "./use-discovery-store";
import { Query, column, literal } from "@uwdata/mosaic-sql";
import type { GraphSchema } from "@/lib/graph-schema";

// ── Types ────────────────────────────────────────────────────────────────

export interface KGGraphData {
  /** subject IRIs (materialized strings, indexed by dense index) */
  ids: string[];
  labels: string[];
  types: string[];
  /** Dense index → GraphAr _id (for graph → SQL bridge) */
  denseToId: number[];
  /** GraphAr _id → dense index (for SQL → graph bridge) */
  idToDense: Map<number, number>;
  /** cosmos.gl typed arrays */
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;
  linkIndexes: Float32Array;
  /** Cluster assignments: one cluster index per node (grouped by type) */
  pointClusters: (number | undefined)[];
  /** Cluster center positions: [x0, y0, x1, y1, ...] distributed in circle */
  clusterPositions: (number | undefined)[];
}

// ── Color palette ────────────────────────────────────────────────────────

const COLORS: [number, number, number][] = [
  [59, 130, 246], [34, 197, 94], [168, 85, 247], [249, 115, 22],
  [239, 68, 68], [20, 184, 166], [234, 179, 8], [236, 72, 153],
];

export const GROUP_CSS_COLORS = [
  "#3b82f6", "#22c55e", "#a855f7", "#f97316",
  "#ef4444", "#14b8a6", "#eab308", "#ec4899",
];

// ── Position seed (deterministic, stable across re-renders) ──────────────

function hashPos(id: string): [number, number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return [((h & 0xffff) / 0xffff - 0.5) * 1000, (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 1000];
}

// ── Hook ─────────────────────────────────────────────────────────────────

interface VertexRow { _id: number; subject: string; display_label: string; type_name: string }
interface EdgeRow { source: number; target: number }

export function useGraphData(schema: GraphSchema | null, typeName?: string): KGGraphData | null {
  // ── Vertex query ───────────────────────────────────────────────────────
  const vertexSQL = useMemo(() => {
    if (!schema) return "";
    const s = schema;

    function typeQuery(t: typeof s.types[number]) {
      const fields = s.fieldsOf(t.name).map((f) => f.name);
      const labelCol = ["name", "label", "title"].find((c) => fields.includes(c));
      const labelExpr = labelCol ? column(labelCol) : column("subject");

      return Query.from(t.name)
        .select({
          _id: column("_id"),
          subject: column("subject"),
          display_label: labelExpr,
          type_name: literal(t.name),
        })
        .toString();
    }

    const types = typeName ? s.types.filter((t) => t.name === typeName) : s.types;
    return types.map(typeQuery).join(" UNION ALL ");
  }, [schema, typeName]);

  const { data: vertexRows } = useCoordinatorQuery<VertexRow>({
    query: vertexSQL,
    enabled: !!vertexSQL,
  });

  // ── Edge query (GraphAr native: source/target are INT _id indices) ─────
  const edgeSQL = useMemo(() => {
    if (!schema) return "";
    const typeNames = new Set(schema.types.map((t) => t.name));
    const validEdges = schema.edges.filter(
      (e) => typeNames.has(e.sourceType) && typeNames.has(e.targetType),
    );
    if (validEdges.length === 0) return "";

    return validEdges
      .map((edge) => Query.from(edge.tableName).select("source", "target").toString())
      .join(" UNION ALL ");
  }, [schema]);

  const { data: edgeRows } = useCoordinatorQuery<EdgeRow>({
    query: edgeSQL,
    enabled: !!edgeSQL,
  });

  // ── Build typed arrays ─────────────────────────────────────────────────
  return useMemo(() => {
    if (!vertexRows || vertexRows.length === 0) return null;

    const n = vertexRows.length;
    const ids: string[] = [];
    const labels: string[] = [];
    const types: string[] = [];
    const denseToId: number[] = [];
    const idToDense = new Map<number, number>();
    const groupColorIdx = new Map<string, number>();

    for (let i = 0; i < n; i++) {
      const row = vertexRows[i];
      ids.push(row.subject);
      labels.push(row.display_label ?? row.subject);
      types.push(row.type_name);
      denseToId.push(row._id);
      idToDense.set(row._id, i);
      if (!groupColorIdx.has(row.type_name)) {
        groupColorIdx.set(row.type_name, groupColorIdx.size % COLORS.length);
      }
    }

    // Positions + colors
    const positions = new Float32Array(n * 2);
    const colors = new Float32Array(n * 4);
    const sizes = new Float32Array(n).fill(4);

    for (let i = 0; i < n; i++) {
      const [x, y] = hashPos(ids[i]);
      positions[i * 2] = x;
      positions[i * 2 + 1] = y;

      const ci = groupColorIdx.get(types[i]) ?? 0;
      const [r, g, b] = COLORS[ci];
      colors[i * 4] = r / 255;
      colors[i * 4 + 1] = g / 255;
      colors[i * 4 + 2] = b / 255;
      colors[i * 4 + 3] = 1;
    }

    // Edges: pre-allocate, then trim
    const edgeLen = edgeRows?.length ?? 0;
    const linkBuf = new Float32Array(edgeLen * 2);
    let edgeIdx = 0;
    if (edgeRows) {
      for (let i = 0; i < edgeLen; i++) {
        const row = edgeRows[i];
        const si = idToDense.get(row.source);
        const ti = idToDense.get(row.target);
        if (si !== undefined && ti !== undefined) {
          linkBuf[edgeIdx++] = si;
          linkBuf[edgeIdx++] = ti;
        }
      }
    }

    // Cluster assignments: each type → a cluster index
    const clusterMap = new Map<string, number>();
    for (const t of types) {
      if (!clusterMap.has(t)) clusterMap.set(t, clusterMap.size);
    }
    const pointClusters: (number | undefined)[] = types.map((t) => clusterMap.get(t));

    // Cluster center positions distributed in a circle (radius = 300)
    const numClusters = clusterMap.size;
    const clusterPositions: (number | undefined)[] = [];
    const radius = Math.min(300, numClusters * 60);
    for (let i = 0; i < numClusters; i++) {
      const angle = (2 * Math.PI * i) / numClusters;
      clusterPositions.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }

    return {
      ids, labels, types, denseToId, idToDense,
      pointPositions: positions,
      pointColors: colors,
      pointSizes: sizes,
      linkIndexes: edgeIdx < linkBuf.length ? linkBuf.subarray(0, edgeIdx) : linkBuf,
      pointClusters,
      clusterPositions,
    };
  }, [vertexRows, edgeRows]);
}
