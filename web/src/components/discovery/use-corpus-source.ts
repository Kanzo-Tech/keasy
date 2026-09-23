/**
 * The bounded source the canvas draws — **the only place `openCorpus` is named.**
 *
 * One vertex class at a time, because that is what the writer lays out: fossil
 * places each type separately and only self-relations feed the placement, so a
 * canvas of several classes is N blobs joined by lines no force ever drew. The
 * class is a choice the reader makes, and {@link crossClassEdges} is what the UI
 * says about the edges that choice leaves off the canvas.
 *
 * `@kanzo-tech/graph` 0.3.0 answers `edges` as ONE view name, which loses the
 * second edge label of a corpus that declares two; nothing here reads it. The
 * fix (a view per relation, plus an `undrawn` list carrying the reason) is
 * unpublished — when it lands, this file is the whole of the upgrade.
 */

"use client";

import { useEffect, useState } from "react";
import { openCorpus, type DuckSource } from "@kanzo-tech/graph/duckdb";
import type { SchemaResult } from "@fossil-lang/corpus";
import type { Selection } from "@uwdata/mosaic-core";
import { useCoordinator, useManifestFiles } from "./use-discovery-store";

const GRAPH_WASM_URL = "/fossil/fossil_graph_wasm_bg.wasm";

export function useCorpusSource(
  vertexType: string | null,
  filterBy?: Selection,
): DuckSource | null {
  const coordinator = useCoordinator();
  const manifestFiles = useManifestFiles();
  // Tagged with what it was opened for, so a class change reads as "still
  // loading" instead of needing an effect to blank the source.
  const [opened, setOpened] = useState<{
    vertexType: string;
    coordinator: unknown;
    source: DuckSource;
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
      .then(({ source }) => {
        if (!cancelled) setOpened({ vertexType, coordinator, source });
      })
      .catch((err) => {
        if (!cancelled) console.error("openCorpus failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [coordinator, manifestFiles, vertexType, filterBy]);

  return opened?.vertexType === vertexType && opened.coordinator === coordinator
    ? opened.source
    : null;
}

/**
 * How many edges touch the drawn class and land somewhere else.
 *
 * Counted from the schema because 0.3.0 does not report it; the unpublished
 * `OpenedCorpus.undrawn` carries the same number with the reason attached, and
 * replaces this function outright.
 */
export function crossClassEdges(schema: SchemaResult | null, vertexType: string | null): number {
  if (!schema || !vertexType) return 0;
  return schema.edges
    .filter(
      (e) =>
        (e.source_type === vertexType || e.target_type === vertexType) &&
        e.source_type !== e.target_type,
    )
    .reduce((sum, e) => sum + e.count, 0);
}
