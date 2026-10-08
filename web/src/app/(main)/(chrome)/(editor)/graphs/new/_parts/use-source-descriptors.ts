"use client";

/**
 * What introspection answered for the sources the graph editor's program reads, to hand to fossil.
 * Fossil answers which sources those are; they are described only when that answer changes, never
 * on a keystroke that leaves it alone.
 *
 * `@fossil-lang/introspect` owns the DESCRIBE each reader needs and the DuckDB→fossil type table.
 * keasy lends it the data plane: its `host` vends a read credential per source connection, and the
 * page's engine reads through it, by range, from the store. The server never reads the file.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { introspect } from "@fossil-lang/introspect";
import { inputs } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/ui/analytics";

import { host } from "@/lib/fossil/host";

export const sourceDescriptorsKey = (sources: readonly string[]) => ["source-descriptors", sources] as const;

/** What could be described, and each source that could not, with its problem — shown, never dropped. */
type Described = Awaited<ReturnType<typeof introspect>>;

/** A pause in typing long enough to ask fossil again which sources the program reads. */
const TYPING_PAUSE_MS = 400;

/**
 * How long a description answers for its sources. It describes the files' contents, which change in
 * the store without keasy hearing of it — not a credential, which fossil renews itself — so it is
 * read again after a few minutes of editing, never on every pause.
 */
const DESCRIPTION_FRESH_MS = 5 * 60_000;

/** Debounce a fast-changing value (editor keystrokes) to one settled value. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Introspection's whole answer, or `null` until there is one. keasy shows none of it: fossil's check
 * reports each undescribed source at its call. Not suspending (fossil docs/design/failure, G2.4): it
 * follows every pause in typing, and the editor stays useful without it.
 */
export function useSourceDescriptors(script: string): Described | null {
  const program = useDebouncedValue(script, TYPING_PAUSE_MS);

  const { data: sources } = useQuery({
    queryKey: ["program-inputs", program],
    queryFn: async ({ signal }) => (await inputs(program, { host, signal })).filter((i) => i.role === "data"),
    staleTime: Infinity,
  });

  const { data } = useQuery({
    queryKey: sourceDescriptorsKey(
      (sources ?? []).map((s) => `${s.format}:${s.location}:${s.option ?? ""}`).sort(),
    ),
    queryFn: async ({ signal }) => introspect(sources ?? [], { host, engine: await engine({ signal }), signal }),
    enabled: !!sources && sources.length > 0,
    retry: false,
    staleTime: DESCRIPTION_FRESH_MS,
  });

  return data ?? null;
}
