"use client";

// eslint-disable-next-line no-restricted-imports -- the preview fails as a state of the chat's, beside the decisions that changed it, and keeps the corpus it had
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Profiled } from "@fossil-lang/types";

import { corpusOf, type Corpus } from "./corpus";
import { host } from "./host";
import { attachInMemory } from "./memory-corpus";
import { runInWorker } from "./run-worker";

/**
 * The assistant's preview: the program run over the first rows of each source, in this tab's run
 * worker and into memory (`into: "memory"`, `executor.ts`), and its corpus attached to the page's
 * engine from those bytes (`memory-corpus.ts`) — nothing written to storage, nothing asked of keasy
 * but the read credentials. The chat answers the person's questions over it, and a decision changed
 * is a program changed, which runs it again: 200 rows, in memory (docs/design/assistant.md, *the
 * preview is in the chat*).
 */

/** Where the preview is: `running` keeps the corpus it replaces on screen until the new one lands. */
export type PreviewState =
  | { state: "idle" }
  | { state: "running"; corpus: Corpus | null }
  | { state: "ready"; corpus: Corpus }
  | { state: "failed"; problem: unknown; corpus: Corpus | null };

/** What SQL calls the preview of `program`: one name per program, so a program changed is a corpus of its own. */
export function previewName(program: string): string {
  // FNV-1a, 32 bits: a name, not a digest anyone relies on.
  let hash = 0x811c9dc5;
  for (let i = 0; i < program.length; i++) hash = Math.imul(hash ^ program.charCodeAt(i), 0x01000193);
  return `preview-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The preview of `program`'s options, cached as every corpus is (`corpusKey`): the previews of
 * programs no longer shown are given back `CORPUS_GC_MS` after the last reader went, and one
 * run again replaces its attachment, which is then detached.
 */
export function previewQuery(program: string, profiled: Profiled | null) {
  const name = previewName(program);
  return corpusOf(name, async (engine, signal) => {
    const { files } = await runInWorker(program, { host, into: "memory", ...(profiled ? { profiled } : {}), signal });
    return attachInMemory(name, files, { engine, signal });
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
  const corpus = query.data ?? null;
  if (query.isError) return { state: "failed", problem: query.error, corpus, rerun };
  if (query.isPlaceholderData || query.isFetching || corpus === null) return { state: "running", corpus, rerun };
  return { state: "ready", corpus, rerun };
}
