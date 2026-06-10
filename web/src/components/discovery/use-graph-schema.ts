"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildGraphSchema,
  foldVertexStats,
  type FieldStatsMap,
  type GraphSchema,
} from "@/lib/graph-schema";
import type { RunStatus } from "@/lib/types";
import { useGraphClient } from "./use-discovery-store";

/**
 * Build the graph schema from a `RunStatus` and, once the verb client is ready,
 * refine it with authoritative role + cardinality from the `describe_vertex_type`
 * verb (one call per type — fossil is the single source). Returns the
 * name/type-only schema (roles default to "dimension") until the stats land.
 */
export function useGraphSchema(manifest: RunStatus): GraphSchema {
  const graphClient = useGraphClient();
  const base = useMemo(() => buildGraphSchema(manifest), [manifest]);
  const [stats, setStats] = useState<FieldStatsMap | null>(null);

  useEffect(() => {
    if (!graphClient) return;
    let cancelled = false;
    Promise.all(
      base.types.map(async (t) => ({
        name: t.name,
        res: await graphClient.describeVertexType({ vertex_type: t.name }),
      })),
    )
      .then((results) => {
        if (cancelled) return;
        const map: FieldStatsMap = new Map();
        for (const { name, res } of results) {
          foldVertexStats(map, name, res.count, res.fields);
        }
        setStats(map);
      })
      .catch((err) => {
        // Surface the failure (the base schema still renders with phase-1
        // roles); a silent swallow here masked WASM-init breakage before.
        console.error("describe_vertex_type failed; using base schema", err);
      });
    return () => {
      cancelled = true;
    };
  }, [graphClient, base]);

  return useMemo(
    () => (stats ? buildGraphSchema(manifest, stats) : base),
    [manifest, stats, base],
  );
}
