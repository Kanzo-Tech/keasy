"use client";

import { useEffect, useMemo, useState } from "react";

import {
  buildGraphSchema,
  type FieldStatsMap,
  type GraphSchema,
} from "@/lib/graph-schema";
import { useCorpus, useCorpusSchema } from "./use-discovery-store";

/**
 * The schema the `schema` verb answered at boot, refined with datatype, role and
 * cardinality — one `schema({ vertex_type })` call per type, which is the shape
 * that costs one query per type instead of one per column. Returns the
 * name-only schema until those land.
 */
export function useGraphSchema(): GraphSchema {
  const corpus = useCorpus();
  const overview = useCorpusSchema();
  const base = useMemo(
    () => buildGraphSchema(overview ?? { vertices: [], edges: [], fields: [] }),
    [overview],
  );
  const [stats, setStats] = useState<FieldStatsMap | null>(null);

  useEffect(() => {
    if (!corpus || !overview) return;
    let cancelled = false;
    Promise.all(
      overview.vertices.map(async (v) => ({
        name: v.name,
        fields: (await corpus.schema({ vertex_type: v.name })).fields,
      })),
    )
      .then((results) => {
        if (cancelled) return;
        setStats(new Map(results.map((r) => [r.name, r.fields])));
      })
      .catch((err) => {
        // Surface the failure (the name-only schema still renders); a silent
        // swallow here masked WASM-init breakage before.
        console.error("schema stats failed; using name-only schema", err);
      });
    return () => {
      cancelled = true;
    };
  }, [corpus, overview]);

  return useMemo(
    () => (overview && stats ? buildGraphSchema(overview, stats) : base),
    [overview, stats, base],
  );
}
