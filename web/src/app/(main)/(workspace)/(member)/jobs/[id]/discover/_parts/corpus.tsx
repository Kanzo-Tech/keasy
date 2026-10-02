"use client";

import { createContext, use, type ReactNode } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { verbatim } from "@uwdata/mosaic-sql";
import type { Close } from "@fossil-lang/corpus";
import { MosaicProvider, engine, queryFieldStats, type Coordinator } from "@kanzo-tech/ui/analytics";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { corpusKey, openJobCorpus, readCatalog, relation, type Catalog, type SqlResult } from "@/lib/fossil/corpus";
import { bookkeeping, type TableStats } from "./field-stats";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

/** A job's corpus, attached under its id to the page's one engine: SQL names it `"<jobId>"."<Table>"`. */
export interface Corpus {
  jobId: string;
  coordinator: Coordinator;
  /** Detaches the corpus. */
  close: Close;
  /** What it holds, read once from its `fossil_tables` and `fossil_columns`. */
  catalog: Catalog;
}

export function corpusQuery(jobId: string) {
  return queryOptions({
    queryKey: corpusKey(jobId),
    queryFn: async ({ signal }): Promise<Corpus> => {
      const [{ coordinator }, close] = await Promise.all([engine({ signal }), openJobCorpus(jobId, { signal })]);
      try {
        return { jobId, coordinator, close, catalog: await readCatalog(coordinator, jobId) };
      } catch (err) {
        await close();
        throw err;
      }
    },
    ...ONCE,
  });
}

// A corpus lives as long as its cache entry: attached by the query, detached when the last observer
// has gone and the entry is collected. An unmount effect would close it under StrictMode's remount.
queryClient.getQueryCache().subscribe((event) => {
  const key = event.query.queryKey;
  if (event.type === "removed" && key.length === 2 && key[0] === "corpus") {
    void (event.query.state.data as Corpus | undefined)?.close();
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

/**
 * Every vertex table's column statistics, one `SUMMARIZE` each — kanzo-ui's own statement on the
 * page's coordinator, so the dashboard asking the same of a table is answered from its cache.
 * Suspends until they land; a failure throws to the boundary.
 */
export function useFieldStats(): TableStats[] {
  const { jobId, coordinator, catalog } = useCorpus();
  const stats = useSuspenseQuery({
    queryKey: [...corpusKey(jobId), "stats"],
    queryFn: () =>
      Promise.all(
        catalog.vertex_tables.map(async (table) => ({
          name: table.name,
          count: table.record_count,
          ...(await queryFieldStats(coordinator, verbatim(relation(jobId, table.name)), { exclude: bookkeeping(table) })),
        })),
      ),
    ...ONCE,
  });
  return settled(stats);
}

/** A `runSql` answer's rows as objects keyed by column, the shape a table and a model read. */
export function recordsOf(result: SqlResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((name, i) => [name, row[i]])));
}
