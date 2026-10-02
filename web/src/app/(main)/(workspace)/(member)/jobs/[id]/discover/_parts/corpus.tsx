"use client";

import { createContext, use, type ReactNode } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode, column, eq, isNotNull, literal } from "@uwdata/mosaic-sql";
import { open, type Close } from "@fossil-lang/corpus";
import { MosaicProvider, Query, engine, queryFieldStats, useMosaic, type Coordinator } from "@kanzo-tech/ui/analytics";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { host } from "@/lib/fossil/host";
import type { TableStats } from "./field-stats";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

/** The root of every cached read of a job's opened output; its own, so invalidating a job never reopens it. */
export const corpusKey = (jobId: string) => ["corpus", jobId] as const;

/**
 * A job's corpus, attached under its id to the page's one engine by fossil's `open`, which asks
 * {@link host} for the read credential: SQL names it `"<jobId>"."<Table>"`, and what it holds is its
 * `fossil_tables` and `fossil_columns`, asked through the coordinator by whoever needs to know.
 */
export interface Corpus {
  jobId: string;
  /** Detaches the corpus. */
  close: Close;
}

/** The corpus, and the coordinator of the engine it was attached to — the one `MosaicProvider` hands down. */
type Opened = Corpus & { coordinator: Coordinator };

export function corpusQuery(jobId: string) {
  return queryOptions({
    queryKey: corpusKey(jobId),
    queryFn: async ({ signal }): Promise<Opened> => {
      const attachedTo = await engine({ signal });
      const close = await open(jobId, { engine: attachedTo, host, signal });
      return { jobId, close, coordinator: attachedTo.coordinator };
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

export function CorpusProvider({ value: { coordinator, ...corpus }, children }: { value: Opened; children: ReactNode }) {
  return (
    <CorpusContext value={corpus}>
      <MosaicProvider coordinator={coordinator} onFailure={chartFailed}>
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

/** The vertex tables, in the manifest's order. */
export const vertexTables = (jobId: string) =>
  Query.from(new TableRefNode([jobId, "fossil_tables"]))
    .select("table_name")
    .where(eq(column("kind"), literal("vertex")))
    .orderby("first_id");

/** Each table's columns the writer gave `role` — or any role: fossil's bookkeeping, not the program's. */
export const roleColumns = (jobId: string, role?: "address" | "identity" | "endpoint") =>
  Query.from(new TableRefNode([jobId, "fossil_columns"]))
    .select("table_name", "column_name")
    .where(role ? eq(column("role"), literal(role)) : isNotNull(column("role")));

/** A statement's rows, as objects keyed by column. */
async function rowsOf<Row>(coordinator: Coordinator, query: Query | string): Promise<Row[]> {
  return (await coordinator.query(query)).toArray() as Row[];
}

/**
 * A statement's rows, suspending until they land. The coordinator caches the answer; the query cache
 * is here for the suspense, and drops it with the page.
 */
export function useRows<Row>(query: Query): Row[] {
  const { jobId } = useCorpus();
  const { coordinator } = useMosaic();
  const sql = String(query);
  return settled(useSuspenseQuery({ queryKey: [...corpusKey(jobId), sql], queryFn: () => rowsOf<Row>(coordinator, sql), ...ONCE }));
}

/** The column the graph keys a vertex by — the `address` column, the same in every vertex table of one corpus. */
export function useGraphKey(): string {
  const [address] = useRows<{ column_name: string }>(roleColumns(useCorpus().jobId, "address"));
  if (!address) throw new Error("The corpus declares no vertex table, so nothing has a key");
  return address.column_name;
}

/**
 * Every vertex table's column statistics, one `SUMMARIZE` each — kanzo-ui's own statement on the
 * page's coordinator, so the dashboard asking the same of a table is answered from its cache. The
 * columns fossil gave a `role` are its bookkeeping, not fields. Suspends until they land; a failure
 * throws to the boundary.
 */
export function useFieldStats(): TableStats[] {
  const { jobId } = useCorpus();
  const { coordinator } = useMosaic();
  const stats = useSuspenseQuery({
    queryKey: [...corpusKey(jobId), "stats"],
    queryFn: async () => {
      const [tables, kept] = await Promise.all([
        rowsOf<{ table_name: string }>(coordinator, vertexTables(jobId)),
        rowsOf<{ table_name: string; column_name: string }>(coordinator, roleColumns(jobId)),
      ]);
      return Promise.all(
        tables.map(async ({ table_name: name }) => ({
          name,
          ...(await queryFieldStats(coordinator, new TableRefNode([jobId, name]), {
            exclude: kept.filter((c) => c.table_name === name).map((c) => c.column_name),
          })),
        })),
      );
    },
    ...ONCE,
  });
  return settled(stats);
}
