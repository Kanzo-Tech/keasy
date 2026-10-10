"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
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
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { corpusKey, RELEASE_FAILED } from "@/lib/fossil/corpus-cache";
import { host } from "@/lib/fossil/host";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

export { corpusKey };

/**
 * How long a corpus stays attached once nothing observes it: TanStack Query's own default. Long
 * enough that whatever its last page left queued on the engine has run, and that a page opened again
 * soon reuses it; short enough that a corpus nobody reads gives its memory back.
 */
export const CORPUS_GC_MS = 5 * 60_000;

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
 * The attach, cached under {@link corpusKey}: every reader of one graph shares one attachment, and
 * it lives the way any cached read does. Each page that reads the corpus observes this query; when
 * the last one goes, the cache waits {@link CORPUS_GC_MS} and removes the entry, and its removal is
 * what detaches it (`releaseCorpora`, registered beside the app's query client). A page that unmounts does
 * not detach anything itself: Mosaic still runs what it queued on the way out — the re-queries a
 * withdrawn filter asks for, the pre-aggregator's tables — and those must find the corpus attached.
 *
 * While a page's children suspend on their own reads, React commits nothing of it, so nothing
 * observes the corpus then either and the timer runs. That is why this was once `gcTime: Infinity`:
 * a short `gcTime` is only floored at 1 s by useSuspenseQuery (`ensureSuspenseTimers`), and a corpus
 * whose first draw took longer, as LDBC SNB's 327.6K vertices do on a CI runner, was collected and
 * detached under its own readers. Minutes are not that floor: a page whose first draw has not
 * committed in five has failed already, so the window no longer needs closing by never collecting.
 */
export function corpusQuery(graphId: string) {
  return queryOptions({
    queryKey: corpusKey(graphId),
    queryFn: async ({ signal }): Promise<Opened> => {
      const attachedTo = await engine({ signal });
      const attachment = await attach(graphId, { engine: attachedTo, host, signal });
      // The cache gave up on this attach while it was out — the entry removed, reset, or its last
      // reader gone — and drops what it resolves to, so no `removed` event will ever carry it.
      // `attach` rejects on an abort only when a step fails, so one that ran to the end lands here:
      // it is given back now, or nothing ever would.
      // Nothing waits on this query any more, so a detach that fails is said here, by the failure path.
      if (signal.aborted) {
        await attachment.detach().catch((err: unknown) => toastError(err, RELEASE_FAILED));
        signal.throwIfAborted();
      }
      return { graphId, attachment, coordinator: attachedTo.coordinator };
    },
    ...ONCE,
    gcTime: CORPUS_GC_MS,
  });
}

const CorpusContext = createContext<Corpus | null>(null);

/**
 * A chart, stat or filter whose query failed draws the failure in its own frame; what was thrown
 * is said once more, by its code, through the toast path every failed action takes.
 */
function chartFailed(error: unknown) {
  toastError(error, "A chart could not be drawn");
}

/**
 * `graphId`'s corpus to everything under it, opened here: suspends while it attaches, and throws to
 * the nearest boundary if it cannot. Its observer of {@link corpusQuery} is what keeps the corpus
 * attached while the page is on screen, so every page that reads a corpus reads it through this.
 */
export function CorpusProvider({ graphId, children }: { graphId: string; children: ReactNode }) {
  const { coordinator, ...corpus } = settled(useSuspenseQuery(corpusQuery(graphId)));
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
 * by: the Ask panel's subset count, and the rules' focus nodes read back as vertices.
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
