"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildGraphSchema,
  computeColumnStats,
  type ColumnStatsMap,
  type GraphSchema,
} from "@/lib/graph-schema";
import type { RunStatus } from "@/lib/types";
import { useCoordinator } from "./use-discovery-store";

/**
 * Build the graph schema from a `RunStatus` and, once the DuckDB-WASM data
 * space is mounted, refine it with browser-computed column cardinality (so role
 * inference can distinguish identifiers from dimensions). Returns the
 * name/type-only schema until the stats land.
 */
export function useGraphSchema(manifest: RunStatus): GraphSchema {
  const coordinator = useCoordinator();
  const base = useMemo(() => buildGraphSchema(manifest), [manifest]);
  const [stats, setStats] = useState<ColumnStatsMap | null>(null);

  useEffect(() => {
    if (!coordinator) return;
    let cancelled = false;
    computeColumnStats(coordinator, base)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        /* stats are an enhancement; fall back to the name/type-only schema */
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, base]);

  return useMemo(
    () => (stats ? buildGraphSchema(manifest, stats) : base),
    [manifest, stats, base],
  );
}
