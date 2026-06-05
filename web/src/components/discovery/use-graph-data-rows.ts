/**
 * useGraphDataRows — materialise the graph for @fossil-lang/viewer's
 * GraphCanvas via the `materialize_graph` verb.
 *
 * The verb owns the GraphAr column convention (`dense_id`/`src_dense`/
 * `dst_dense`), the display-label rule, the dense→subject edge mapping, and the
 * orphan-edge drop — so keasy hand-builds NO SQL here. We only adapt the verb's
 * `{id,label,type_name}` / `{source,target,predicate}` shape to the viewer's
 * `VertexRow` / `EdgeRow`.
 *
 * Returns `null` while loading so consumers can render a loader (the viewer
 * treats `vertices=[]` as an empty state).
 */

"use client";

import { useEffect, useState } from "react";
import type { VertexRow, EdgeRow } from "@fossil-lang/viewer";
import { useGraphClient } from "./use-discovery-store";

export interface GraphDataRows {
  vertices: VertexRow[];
  edges: EdgeRow[];
}

export function useGraphDataRows(): GraphDataRows | null {
  const graphClient = useGraphClient();
  const [rows, setRows] = useState<GraphDataRows | null>(null);

  useEffect(() => {
    if (!graphClient) {
      setRows(null);
      return;
    }
    let cancelled = false;
    graphClient
      .materializeGraph({})
      .then((res) => {
        if (cancelled) return;
        const vertices: VertexRow[] = res.vertices.map((v) => ({
          id: v.id,
          type: v.type_name,
          label: v.label,
        }));
        const edges: EdgeRow[] = res.edges.map((e) => ({
          source: e.source,
          target: e.target,
          predicate: e.predicate,
        }));
        setRows({ vertices, edges });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("materialize_graph failed", err);
        setRows({ vertices: [], edges: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [graphClient]);

  return rows;
}
