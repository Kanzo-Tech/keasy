"use client";

import { createContext, use, type ReactNode } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import type { Manifest, SqlCorpus, SqlResult } from "@fossil-lang/corpus";
import { MosaicProvider, engine, type Coordinator } from "@kanzo-tech/ui/analytics";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { corpusKey, openJobCorpus } from "@/lib/fossil/corpus";
import { summarize, type TableStats } from "./field-stats";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

export interface Corpus {
  jobId: string;
  coordinator: Coordinator;
  corpus: SqlCorpus;
  manifest: Manifest;
  /** A relation's name as SQL reads it: `"jobs/7"."Person"`, in the corpus's own catalog. */
  relation: (name: string) => string;
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

export function corpusQuery(jobId: string) {
  return queryOptions({
    queryKey: corpusKey(jobId),
    queryFn: async ({ signal }): Promise<Corpus> => {
      const [{ coordinator }, corpus] = await Promise.all([engine({ signal }), openJobCorpus(jobId, { signal })]);
      const { manifest } = corpus;
      const names = new Set([...manifest.vertex_tables, ...manifest.edge_tables].map((t) => t.name));
      const relation = (name: string) => {
        if (!names.has(name)) throw new Error(`The corpus has no relation ${name}`);
        return `${quote(corpus.url)}.${quote(name)}`;
      };
      return { jobId, coordinator, corpus, manifest, relation };
    },
    ...ONCE,
  });
}

// A corpus lives as long as its cache entry: opened by the query, closed when the last observer
// has gone and the entry is collected. An unmount effect would close it under StrictMode's remount.
queryClient.getQueryCache().subscribe((event) => {
  const key = event.query.queryKey;
  if (event.type === "removed" && key.length === 2 && key[0] === "corpus") {
    void (event.query.state.data as Corpus | undefined)?.corpus.close();
  }
});

const CorpusContext = createContext<Corpus | null>(null);

/**
 * A chart, stat or filter whose query failed draws the failure in its own frame; what was thrown
 * is said once more, by its code, through the toast path every failed action takes.
 */
function chartFailed(error: unknown) {
  toastError(error, "A chart could not be drawn");
}

export function CorpusProvider({ value, children }: { value: Corpus; children: ReactNode }) {
  return (
    <CorpusContext value={value}>
      <MosaicProvider coordinator={value.coordinator} onFailure={chartFailed}>
        {children}
      </MosaicProvider>
    </CorpusContext>
  );
}

export function useCorpus(): Corpus {
  const corpus = use(CorpusContext);
  if (!corpus) throw new Error("useCorpus must be used within CorpusProvider");
  return corpus;
}

/** Every vertex table's column statistics, one `SUMMARIZE` each. Suspends until they land; a failure throws to the boundary. */
export function useFieldStats(): TableStats[] {
  const { jobId, corpus, manifest, relation } = useCorpus();
  const stats = useSuspenseQuery({
    queryKey: [...corpusKey(jobId), "stats"],
    queryFn: ({ signal }) =>
      Promise.all(
        manifest.vertex_tables.map(async (table) =>
          summarize(table, await corpus.sql(`SUMMARIZE ${relation(table.name)}`, { signal })),
        ),
      ),
    ...ONCE,
  });
  return settled(stats);
}

/** A `sql` answer's rows as objects keyed by column, the shape a table and a model read. */
export function recordsOf(result: SqlResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((name, i) => [name, row[i]])));
}
