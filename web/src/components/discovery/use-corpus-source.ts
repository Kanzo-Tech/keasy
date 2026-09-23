/**
 * The bounded source the canvas draws — **the only place `openCorpus` is named.**
 *
 * One vertex class at a time, because that is what the writer lays out: fossil
 * places each type separately and only self-relations feed the placement, so a
 * canvas of several classes is N blobs joined by lines no force ever drew. Which
 * relations that leaves off the canvas is not this file's guess any more: 0.4.0
 * reports them as {@link UndrawnRelation}, with the reason attached, and
 * {@link undrawnEdges} only has to put a size on each one.
 */

"use client";

import { useEffect, useState } from "react";
import { openCorpus, type DuckSource, type UndrawnRelation } from "@kanzo-tech/graph/duckdb";
import type { SchemaResult } from "@fossil-lang/corpus";
import type { Selection } from "@uwdata/mosaic-core";
import { useCoordinator, useManifestFiles } from "./use-discovery-store";

const GRAPH_WASM_URL = "/fossil/fossil_graph_wasm_bg.wasm";

export interface CorpusView {
  source: DuckSource;
  undrawn: readonly UndrawnRelation[];
}

export function useCorpusSource(
  vertexType: string | null,
  filterBy?: Selection,
): CorpusView | null {
  const coordinator = useCoordinator();
  const manifestFiles = useManifestFiles();
  // Tagged with what it was opened for, so a class change reads as "still
  // loading" instead of needing an effect to blank the source.
  const [opened, setOpened] = useState<{
    vertexType: string;
    coordinator: unknown;
    view: CorpusView;
  } | null>(null);

  useEffect(() => {
    if (!coordinator || !vertexType) return;
    let cancelled = false;
    openCorpus({
      coordinator,
      dest: "",
      filterBy,
      readText: async (url) => {
        const text = manifestFiles[url];
        if (text === undefined) throw new Error(`${url} is not a manifest this job published`);
        return text;
      },
      subjects: true,
      vertexType,
      wasmUrl: GRAPH_WASM_URL,
    })
      .then(({ source, undrawn }) => {
        if (!cancelled) setOpened({ vertexType, coordinator, view: { source, undrawn } });
      })
      .catch((err) => {
        if (!cancelled) console.error("openCorpus failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, manifestFiles, vertexType, filterBy]);

  return opened?.vertexType === vertexType && opened.coordinator === coordinator
    ? opened.view
    : null;
}

export interface UndrawnSummary {
  /** Edges whose other endpoint is another class, so this canvas holds no coordinates for it. */
  otherClasses: number;
  /** Edges of the drawn class itself for which the corpus published no adjacency. */
  notDeclared: number;
}

/**
 * How many edges each undrawn relation holds.
 *
 * The reader says WHICH relations are off the canvas and WHY; only the schema
 * knows how big each one is, so the size comes from there and the membership
 * does not. Counting cross-type relations here — which is what this did before
 * `undrawn` existed — got `not-declared` wrong in both directions: it counted
 * relations the canvas does draw, and missed a self-relation with no adjacency.
 */
export function undrawnEdges(
  undrawn: readonly UndrawnRelation[] | undefined,
  schema: SchemaResult | null,
): UndrawnSummary {
  const summary: UndrawnSummary = { otherClasses: 0, notDeclared: 0 };
  if (!undrawn || !schema) return summary;
  for (const relation of undrawn) {
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
