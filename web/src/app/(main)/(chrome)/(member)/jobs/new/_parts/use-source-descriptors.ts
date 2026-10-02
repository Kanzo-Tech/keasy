"use client";

/**
 * The descriptors of the sources the job editor's program reads, for
 * source-field completion. Fossil answers which sources those are; they are
 * described only when that answer changes, never on a keystroke that leaves it
 * alone.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InferredDescriptor, UndescribedSource } from "@fossil-lang/introspect";

import * as checker from "@/lib/fossil/checker";
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

/**
 * The descriptors, and why they could not be read. The named exception to "useSuspenseQuery only"
 * (fossil docs/design/failure, G2.4): it follows every pause in typing, the editor stays useful
 * without it, and suspending the editor on a keystroke would be the wrong answer — so the failure is
 * returned to be shown beside the program instead of thrown.
 */
export function useSourceDescriptors(script: string): {
  descriptors: InferredDescriptor[];
  undescribed: UndescribedSource[];
  error: unknown;
} {
  const program = useDebouncedValue(script, 400);

  const { data: sources, error: sourcesError } = useQuery({
    queryKey: ["program-sources", program],
    queryFn: async ({ signal }) => (await checker.jobProgram({ signal })).sources(program),
    staleTime: Infinity,
  });

  const { data, error } = useQuery({
    queryKey: sourceDescriptorsKey(
      (sources ?? []).map((s) => `${s.format}:${s.locator}:${s.option ?? ""}`).sort(),
    ),
    queryFn: ({ signal }) => describeSources(sources ?? [], signal),
    enabled: !!sources && sources.length > 0,
    retry: false,
    // Signed URLs live five minutes; a description older than that is re-asked.
    staleTime: 4 * 60_000,
  });

  return { descriptors: data?.descriptors ?? NONE, undescribed: data?.undescribed ?? [], error: sourcesError ?? error };
}
