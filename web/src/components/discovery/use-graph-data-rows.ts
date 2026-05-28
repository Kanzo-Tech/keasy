/**
 * useGraphDataRows — adapter bridging Keasy's Mosaic/DuckDB coordinator
 * to @fossil-lang/viewer's string-shaped `VertexRow[]/EdgeRow[]` API.
 *
 * Keasy keeps the lazy DuckDB-over-httpfs query path (zero-copy where
 * possible — see use-graph-data.ts for the original typed-array build).
 * The viewer (`@fossil-lang/viewer/GraphCanvas`) is intentionally
 * decoupled from any query coordinator — it takes raw vertex/edge rows
 * so the landing playground can use it without DuckDB. This adapter
 * materializes Keasy's UNION-ALL vertex + edge SQL into the
 * `{id, type, label}` row shape the viewer expects.
 *
 * Design notes:
 *  - Vertex SQL lifted from use-graph-data.ts L64-87 (one SELECT per
 *    vertex type with `_id`, `subject`, `display_label`, `type_name`).
 *  - Edge SQL UNION-ALLs `source` + `target` (numeric GraphAr _ids) for
 *    every valid edge in the schema, plus a literal `predicate` = edge
 *    name so the viewer can label edges if desired.
 *  - Edge endpoints are rewritten from GraphAr numeric `_id` → vertex
 *    `subject` strings via an in-memory map (the viewer keys edges by
 *    string id, not dense index). Orphan edges (endpoint not in the
 *    materialized vertex set) are dropped defensively to avoid
 *    Cosmos.gl console warnings — happens when type filters partition
 *    vertices but not edges.
 *  - Returns `null` while either query is loading so consumers can
 *    render a loader. Keasy's old in-tree GraphCanvas absorbed that
 *    wait internally; the viewer's GraphCanvas treats `vertices=[]`
 *    as an empty state, so a Keasy-side loader is required to preserve
 *    pre-migration UX.
 *
 * Port-of: use-graph-data.ts L62-114 (the SQL build halves only;
 * the Float32Array build half lives inside @fossil-lang/viewer now).
 */

"use client";

import { useMemo } from "react";
import { Query, column, literal } from "@uwdata/mosaic-sql";
import type { VertexRow, EdgeRow } from "@fossil-lang/viewer";
import { useCoordinatorQuery } from "./use-discovery-store";
import type { GraphSchema } from "@/lib/graph-schema";

// Internal row shapes (as DuckDB returns them via Mosaic).
interface VertexRowRaw {
  _id: number;
  subject: string;
  display_label: string;
  type_name: string;
}

interface EdgeRowRaw {
  source: number; // GraphAr _id, NOT a vertex string id
  target: number;
  predicate?: string;
}

export interface GraphDataRows {
  vertices: VertexRow[];
  edges: EdgeRow[];
}

export function useGraphDataRows(schema: GraphSchema | null): GraphDataRows | null {
  // ── Vertex SQL — UNION ALL of one SELECT per type ───────────────────────
  const vertexSQL = useMemo(() => {
    if (!schema) return "";
    return schema.types
      .map((t) => {
        const fields = schema.fieldsOf(t.name).map((f) => f.name);
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
      })
      .join(" UNION ALL ");
  }, [schema]);

  // ── Edge SQL — UNION ALL over schema.edges ──────────────────────────────
  // Columns: source/target (numeric GraphAr _ids) + literal predicate.
  // The literal predicate carries the edge name so the viewer can label
  // edges; Keasy's original useGraphData dropped it (visual edges only).
  const edgeSQL = useMemo(() => {
    if (!schema) return "";
    const typeNames = new Set(schema.types.map((t) => t.name));
    const validEdges = schema.edges.filter(
      (e) => typeNames.has(e.sourceType) && typeNames.has(e.targetType),
    );
    if (validEdges.length === 0) return "";
    return validEdges
      .map((e) =>
        Query.from(e.tableName)
          .select({
            source: column("source"),
            target: column("target"),
            predicate: literal(e.name),
          })
          .toString(),
      )
      .join(" UNION ALL ");
  }, [schema]);

  const { data: vRows } = useCoordinatorQuery<VertexRowRaw>({
    query: vertexSQL,
    enabled: !!vertexSQL,
  });
  const { data: eRows } = useCoordinatorQuery<EdgeRowRaw>({
    query: edgeSQL,
    enabled: !!edgeSQL,
  });

  return useMemo(() => {
    if (!vRows) return null;

    // _id (numeric) → subject (string) so edges can be rewritten.
    const idToSubject = new Map<number, string>();
    for (const v of vRows) idToSubject.set(v._id, v.subject);

    const vertices: VertexRow[] = vRows.map((v) => ({
      id: v.subject,
      type: v.type_name,
      label: v.display_label ?? v.subject,
    }));

    const edges: EdgeRow[] = (eRows ?? []).flatMap((e) => {
      const src = idToSubject.get(e.source);
      const dst = idToSubject.get(e.target);
      if (!src || !dst) return []; // drop orphan edges defensively
      return [{ source: src, target: dst, predicate: e.predicate }];
    });

    return { vertices, edges };
  }, [vRows, eRows]);
}
