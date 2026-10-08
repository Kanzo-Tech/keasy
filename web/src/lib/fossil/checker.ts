import "client-only";

import { formats, openProgram, type FossilProgram } from "@fossil-lang/wasm";

import { host } from "./host";

/** The key the graph's program is open under: every `Diagnostic.uri` about it. */
export const GRAPH_URI = "graph.fossil";

let opened: Promise<FossilProgram> | undefined;

/**
 * The graph's program, open once per tab: every editor of the tab shares it.
 * A failed open is forgotten, so the next call tries again rather than every caller inheriting one
 * transient failure until the tab reloads.
 */
export function graphProgram(): Promise<FossilProgram> {
  if (opened === undefined) {
    const opening = openProgram(GRAPH_URI, { host });
    opened = opening;
    opening.catch(() => {
      // The caller that awaited it sees the failure; this only clears the cache for the next one.
      if (opened === opening) opened = undefined;
    });
  }
  return opened;
}

/** Compiled into the module, so they never go stale. */
export const formatsQuery = {
  queryKey: ["fossil", "formats"],
  queryFn: ({ signal }: { signal: AbortSignal }) => formats({ signal }),
  staleTime: Infinity,
} as const;
