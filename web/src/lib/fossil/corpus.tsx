"use client";

import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode, column, eq, literal } from "@uwdata/mosaic-sql";
import { attach, type Attachment } from "@fossil-lang/corpus";
import { readJoinGraph } from "@kanzo-tech/graph";
import {
  MosaicProvider,
  Query,
  engine,
  useMosaic,
  useQueryRows,
  type Coordinator,
  type JoinGraph,
} from "@kanzo-tech/ui/analytics";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { host } from "@/lib/fossil/host";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

/** The root of every cached read of a graph's attached output; its own, so invalidating a graph never reattaches it. */
export const corpusKey = (graphId: string) => ["corpus", graphId] as const;

/**
 * A graph's corpus, attached under its id to the page's one engine by fossil's `attach`, which asks
 * {@link host} for the read credential: SQL names it `"<graphId>"."<Table>"`, and what it holds is its
 * `fossil_tables`, `fossil_columns` and `triples`, asked through the coordinator by whoever needs to know.
 */
export interface Corpus {
  graphId: string;
  attachment: Attachment;
}

/** The corpus, and the coordinator of the engine it was attached to — the one `MosaicProvider` hands down. */
type Opened = Corpus & { coordinator: Coordinator };

/**
 * The attach, cached under {@link corpusKey}: every reader of one graph shares one attachment. The
 * cache never collects it (`gcTime: Infinity`, which TanStack Query documents as disabling garbage
 * collection): collecting is the cache's decision about memory, taken on a timer, and a page whose
 * readers are suspended holds no observer of it while they are. useSuspenseQuery floors `gcTime` at
 * 1 s (`ensureSuspenseTimers`) for exactly that window, so on a slow machine a corpus collected — and
 * detached — under its own suspended readers failed them with `schema "<graph>" does not exist`.
 * What ends an attachment is the page that holds it: {@link CorpusProvider}.
 */
export function corpusQuery(graphId: string) {
  return queryOptions({
    queryKey: corpusKey(graphId),
    queryFn: async ({ signal }): Promise<Opened> => {
      const attachedTo = await engine({ signal });
      const attachment = await attach(graphId, { engine: attachedTo, host, signal });
      return { graphId, attachment, coordinator: attachedTo.coordinator };
    },
    ...ONCE,
    gcTime: Infinity,
  });
}

/** How many committed providers hold each graph's corpus. */
const holders = new Map<string, number>();

/**
 * Hold `graphId`'s corpus while the calling component is committed. The last holder to go detaches
 * it and drops every read under {@link corpusKey}, after the commit it went in: a navigation that
 * swaps one page holding the graph for another, and StrictMode's remount, re-hold it in that same
 * commit, so neither detaches. Nothing holds a corpus before its page first commits, and nothing
 * releases it then either: a page left while it was still suspended leaves its corpus attached and
 * cached, for the next visit to reuse.
 */
function useHold(graphId: string) {
  useEffect(() => {
    holders.set(graphId, (holders.get(graphId) ?? 0) + 1);
    return () => {
      const left = (holders.get(graphId) ?? 1) - 1;
      if (left > 0) return void holders.set(graphId, left);
      holders.delete(graphId);
      setTimeout(() => {
        if (holders.has(graphId)) return;
        const opened = queryClient.getQueryData<Opened>(corpusKey(graphId));
        queryClient.removeQueries({ queryKey: corpusKey(graphId) });
        void opened?.attachment.detach();
      });
    };
  }, [graphId]);
}

const CorpusContext = createContext<Corpus | null>(null);

/**
 * A chart, stat or filter whose query failed draws the failure in its own frame; what was thrown
 * is said once more, by its code, through the toast path every failed action takes.
 */
function chartFailed(error: unknown) {
  toastError(error, "A chart could not be drawn");
}

/** The corpus to everything under it, held attached for as long as this is committed. */
export function CorpusProvider({ value: { coordinator, ...corpus }, children }: { value: Opened; children: ReactNode }) {
  useHold(corpus.graphId);
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

/** Each table's columns the writer gave `role`: fossil's bookkeeping, not the program's. */
const roleColumns = (graphId: string, role: "address" | "identity") =>
  Query.from(new TableRefNode([graphId, "fossil_columns"]))
    .select("table_name", "column_name")
    .where(eq(column("role"), literal(role)));

/** The column the graph keys a vertex by — the `address` column, the same in every vertex table of one corpus. */
export function useGraphKey(): string {
  const [address] = useQueryRows<{ column_name: string }>(roleColumns(useCorpus().graphId, "address"));
  if (!address) throw new Error("The corpus declares no vertex table, so nothing has a key");
  return address.column_name;
}

/**
 * Every vertex of the corpus as one relation — its key, its `subject` (the `identity` column, the
 * IRI the corpus's RDF mapping makes of it) and its `type` — one `SELECT` per vertex table, unioned.
 * It is what a selection on the graph filters whatever the type, so it is the relation a panel scopes
 * by: the Ask agent's `scope`, and the rules' focus nodes read back as vertices.
 */
export function useVertices(): Query {
  const { graphId } = useCorpus();
  const key = useGraphKey();
  const subjects = useQueryRows<{ table_name: string; column_name: string }>(roleColumns(graphId, "identity"));
  return useMemo(
    () =>
      Query.unionAll(
        ...subjects.map(({ table_name, column_name }) =>
          Query.from(new TableRefNode([graphId, table_name])).select({
            [key]: column(key),
            subject: column(column_name),
            type: literal(table_name),
          }),
        ),
      ),
    [graphId, key, subjects],
  );
}

/** The corpus's join graph — its types and the edges between them — read once from its catalog. */
export function useJoinGraph(): JoinGraph {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "join-graph"],
      queryFn: () => readJoinGraph(coordinator, graphId),
      ...ONCE,
    }),
  );
}
