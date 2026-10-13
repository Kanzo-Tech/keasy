import "client-only";

import { formats, openProgram, type FossilProgram } from "@fossil-lang/wasm";

import { queryClient } from "@/lib/api/query-client";

import { host } from "./host";

/** The key the graph's program is open under: every `Diagnostic.uri` about it. */
export const GRAPH_URI = "graph.fossil";

/**
 * The graph's program, open once per tab: every editor of the tab shares it. A failed open is not
 * kept — a query that failed is fetched again — so one transient failure does not last the tab.
 */
export function graphProgram(): Promise<FossilProgram> {
  return queryClient.fetchQuery({
    queryKey: ["fossil", "program"],
    queryFn: () => openProgram(GRAPH_URI, { host }),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Compiled into the module, so they never go stale. */
export const formatsQuery = {
  queryKey: ["fossil", "formats"],
  queryFn: ({ signal }: { signal: AbortSignal }) => formats({ signal }),
  staleTime: Infinity,
} as const;
