"use client";

/**
 * The descriptors of the sources the job editor's program reads, for
 * source-field completion. Fossil answers which sources those are; they are
 * described only when that answer changes, never on a keystroke that leaves it
 * alone.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InferredDescriptor } from "@fossil-lang/introspect";

import * as checker from "./checker";
import { describeSources, sourceDescriptorsKey } from "./describe-sources";

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

export function useSourceDescriptors(script: string): InferredDescriptor[] {
  const program = useDebouncedValue(script, 400);

  const { data: sources } = useQuery({
    queryKey: ["program-sources", program],
    queryFn: () => checker.sources(program),
    staleTime: Infinity,
  });

  const { data } = useQuery({
    queryKey: sourceDescriptorsKey(
      (sources ?? []).map((s) => `${s.format}:${s.locator}:${s.option ?? ""}`).sort(),
    ),
    queryFn: () => describeSources(sources ?? []),
    enabled: !!sources && sources.length > 0,
    retry: false,
    // Signed URLs live five minutes; a description older than that is re-asked.
    staleTime: 4 * 60_000,
  });

  return data ?? NONE;
}
