"use client";

/**
 * The sources the graph editor's program reads, described and handed to its checker. Fossil answers
 * which sources those are; they are described only when that answer changes, never on a keystroke
 * that leaves it alone.
 *
 * `program.describe` is fossil's profile at its `types` depth — one DESCRIBE a source — over the
 * program's own inputs, registered with its checker as it answers. keasy lends it the data plane:
 * its `host` vends a read credential per source connection, and the page's engine reads through
 * it, by range, from the store. The server never reads the file.
 */

import { useEffect, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- follows every pause in typing; the editor shows the failure beside the program
import { useQuery } from "@tanstack/react-query";
import { type FossilProgram, inputs } from "@fossil-lang/wasm";
import { engine } from "@kanzo-tech/mosaic";

import { host } from "@/lib/fossil/host";

const sourceDescriptorsKey = (sources: readonly string[]) => ["source-descriptors", sources] as const;

/** What could be described, and each source that could not, with its problem — shown, never dropped. */
type Described = Awaited<ReturnType<FossilProgram["describe"]>>;

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
 * The description's whole answer, or `null` until there is one — given to `opened`'s checker as it
 * answers. keasy shows none of it: fossil's check reports each undescribed source at its call. Not
 * suspending (fossil docs/design/failure, G2.4): it follows every pause in typing, and the editor
 * stays useful without it.
 */
export function useSourceDescriptors(script: string, opened: FossilProgram | null): Described | null {
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
    queryFn: async ({ signal }) => opened!.describe({ engine: await engine({ signal }), options: { depth: "types" }, signal }),
    enabled: !!opened && !!sources && sources.length > 0,
    retry: false,
    staleTime: DESCRIPTION_FRESH_MS,
  });

  return data ?? null;
}
