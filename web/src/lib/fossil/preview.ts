"use client";

// eslint-disable-next-line no-restricted-imports -- the preview fails as a state of the chat's, beside the decisions that changed it, and keeps the graph it had
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Profiled } from "@fossil-lang/types";

import { attachFiles } from "./attach";
import { graphOf, type AttachedGraph } from "./graph";
import { runInto } from "./executor";
import { host } from "./host";

/**
 * The assistant's preview: the program run over the first rows of each source, in fossil's run
 * worker and into memory (`into: "memory"`, `executor.ts`), and its graph attached to the page's
 * engine from those bytes (`attachFiles`: GraphAr's `attachGraph` over the buffers the run answered) — nothing written to storage, nothing asked of keasy
 * but the read credentials. The chat answers the person's questions over it, and a decision changed
 * is a program changed, which runs it again: 200 rows, in memory (docs/design/assistant.md, *the
 * preview is in the chat*).
 */

/** Where the preview is: `running` keeps the graph it replaces on screen until the new one lands. */
export type PreviewState =
  | { state: "idle" }
  | { state: "running"; graph: AttachedGraph | null }
  | { state: "ready"; graph: AttachedGraph }
  | { state: "failed"; problem: unknown; graph: AttachedGraph | null };

/** What SQL calls the preview of `program`: one name per program, so a program changed is a graph of its own. */
export function previewName(program: string): string {
  // FNV-1a, 32 bits: a name, not a digest anyone relies on.
  let hash = 0x811c9dc5;
  for (let i = 0; i < program.length; i++) hash = Math.imul(hash ^ program.charCodeAt(i), 0x01000193);
  return `preview-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The preview of `program`'s options, cached as every graph is (`graphKey`): the previews of
 * programs no longer shown are given back `GRAPH_GC_MS` after the last reader went, and one
 * run again replaces its attachment, which is then detached.
 */
export function previewQuery(program: string, profiled: Profiled | null) {
  const name = previewName(program);
  return graphOf(name, async (engine, signal) => {
    const { files } = await runInto(program, { host, into: "memory", ...(profiled ? { profiled } : {}), signal });
    return attachFiles(name, { engine, files, signal });
  });
}

/**
 * The preview of `program`, run as soon as there is one and again whenever it changes: `idle` while
 * `program` is `null`. `rerun` runs the same program again — after a failure, or a source changed.
 */
export function usePreview(program: string | null, profiled: Profiled | null): PreviewState & { rerun: () => void } {
  const query = useQuery({
    ...previewQuery(program ?? "", profiled),
    enabled: program !== null,
    placeholderData: keepPreviousData,
  });
  const rerun = () => void query.refetch();
  if (program === null) return { state: "idle", rerun };
  const graph = query.data ?? null;
  if (query.isError) return { state: "failed", problem: query.error, graph, rerun };
  if (query.isPlaceholderData || query.isFetching || graph === null) return { state: "running", graph, rerun };
  return { state: "ready", graph, rerun };
}
