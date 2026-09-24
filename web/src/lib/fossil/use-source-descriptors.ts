"use client";

/**
 * The descriptors of the sources the job editor's program binds, for
 * source-field completion. Described in the browser (see `describe-sources`),
 * re-asked only when the set of bindings or connections changes, never on a
 * keystroke that leaves them alone.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { extractSourceRefs, type InferredDescriptor } from "@fossil-lang/introspect";

import { queryKeys } from "@/lib/query-keys";
import type { Connection } from "@/lib/types";
import { describeSources } from "./describe-sources";

const NONE: InferredDescriptor[] = [];

/** Debounce a fast-changing value (editor keystrokes) to one settled value. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useSourceDescriptors(
  script: string,
  connections: Connection[],
): InferredDescriptor[] {
  const program = useDebouncedValue(script, 400);

  // What the answer depends on: the bindings (constructor, URI, option) and the
  // data connections they can resolve against.
  const bindings = useMemo(
    () =>
      extractSourceRefs(program)
        .map((ref) => `${ref.format}:${ref.url}:${ref.option ?? ""}`)
        .sort(),
    [program],
  );
  const sources = useMemo(
    () =>
      connections
        .filter((c) => c.kind === "data")
        .map((c) => `${c.id}:${c.name}`)
        .sort(),
    [connections],
  );

  const { data } = useQuery({
    queryKey: queryKeys.sourceDescriptors(bindings, sources),
    queryFn: () => describeSources(program, connections),
    enabled: bindings.length > 0,
    retry: false,
    // Signed URLs live five minutes; a description older than that is re-asked.
    staleTime: 4 * 60_000,
  });

  return data ?? NONE;
}
