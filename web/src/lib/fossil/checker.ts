import "client-only";

import { openProgram, providers, type FossilProgram } from "@fossil-lang/wasm";

import { until } from "@fossil-lang/types";

import { host } from "./host";

export type { CheckRow, ProviderInfo, SourceRefInfo } from "@fossil-lang/wasm";

/** The key the graph's program is open under: every `CheckRow.uri` about it. */
export const GRAPH_URI = "graph.fossil";

let opened: Promise<FossilProgram> | undefined;

/**
 * The graph's program, open once per tab: the editor, its introspection and the assistant share it.
 * A failed open is forgotten, so the next call tries again rather than every caller inheriting one
 * transient failure until the tab reloads. The open is shared, so a caller's `signal` ends only its
 * own wait, never the open the others are waiting on.
 */
export function graphProgram({ signal }: { signal?: AbortSignal } = {}): Promise<FossilProgram> {
  return until(opening(), signal);
}

function opening(): Promise<FossilProgram> {
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
export const providersQuery = {
  queryKey: ["fossil", "providers"],
  queryFn: ({ signal }: { signal: AbortSignal }) => providers({ signal }),
  staleTime: Infinity,
} as const;
