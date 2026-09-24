/**
 * The bounded source the canvas draws — **the only place `openCorpus` is named.**
 *
 * One vertex class at a time, because that is what the writer lays out: fossil
 * places each type separately and only self-relations feed the placement, so a
 * canvas of several classes is N blobs joined by lines no force ever drew. Which
 * relations that leaves off the canvas the reader reports as
 * {@link UndrawnRelation}, with the reason attached; {@link undrawnEdges} only
 * puts a size on each one.
 */

"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { openCorpus, type UndrawnRelation } from "@kanzo-tech/graph/duckdb";
import { useCrossfilter, useMosaic } from "@kanzo-tech/ui/analytics";
import type { SchemaResult } from "@fossil-lang/corpus";
import { GRAPH_WASM_URL } from "@/lib/fossil/open-job-corpus";
import { queryKeys } from "@/lib/query-keys";
import { ONCE, useCorpus } from "./corpus";

export function useCorpusSource(vertexType: string | null) {
  const { jobId, manifestFiles } = useCorpus();
  const { coordinator } = useMosaic();
  const crossfilter = useCrossfilter();
  const readText = async (url: string) => {
    const text = manifestFiles[url];
    if (text === undefined) throw new Error(`${url} is not a manifest this job published`);
    return text;
  };
  return useQuery({
    queryKey: [...queryKeys.corpus(jobId), "source", vertexType],
    queryFn:
      vertexType === null
        ? skipToken
        : () =>
            openCorpus({
              coordinator,
              dest: "",
              filterBy: crossfilter,
              readText,
              subjects: true,
              vertexType,
              wasmUrl: GRAPH_WASM_URL,
            }),
    ...ONCE,
  });
}

export interface UndrawnSummary {
  /** Edges whose other endpoint is another class, so this canvas holds no coordinates for it. */
  otherClasses: number;
  /** Edges of the drawn class itself for which the corpus published no adjacency. */
  notDeclared: number;
}

/**
 * How many edges each undrawn relation holds. The reader says WHICH relations
 * are off the canvas and WHY; only the schema knows how big each one is.
 */
export function undrawnEdges(
  undrawn: readonly UndrawnRelation[] | undefined,
  schema: SchemaResult,
): UndrawnSummary {
  const summary: UndrawnSummary = { otherClasses: 0, notDeclared: 0 };
  for (const relation of undrawn ?? []) {
    const count =
      schema.edges.find(
        (e) =>
          e.name === relation.edgeType &&
          e.source_type === relation.srcType &&
          e.target_type === relation.dstType,
      )?.count ?? 0;
    if (relation.reason === "other-space") summary.otherClasses += count;
    else summary.notDeclared += count;
  }
  return summary;
}
