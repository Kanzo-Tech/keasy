"use client";

import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
// eslint-disable-next-line no-restricted-imports -- the mapping describes the graph after its first paint; a mapping that cannot be read leaves the graph in the names its tables have
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { readJoinGraph } from "@kanzo-tech/graph";
import { engine, withMapping, type Engine, type JoinGraph, type TableExpr } from "@kanzo-tech/mosaic";
import { MosaicProvider, useMosaic } from "@kanzo-tech/ui/analytics";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { type Attachment, attachJob } from "@/lib/fossil/attach";
import { corpusKey, RELEASE_FAILED } from "@/lib/fossil/corpus-cache";
import { host } from "@/lib/fossil/host";
import { parseMapping } from "@/lib/fossil/rudof";

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
 * A graph attached under {@link Corpus.name} to the page's one engine: a graph's output, GraphAr's
 * `attachGraph` over the credential {@link host} vends for it (`lib/fossil/attach.ts`) — or the
 * assistant's preview, answered in memory (`lib/fossil/preview.ts`). SQL names it
 * `"<name>"."<Type>"`, and what it holds is its `graphar_*` relations, asked through the coordinator
 * by whoever needs to know; what its tables mean is `mapping.ttl` beside it (`mappingQuery`).
 * Everything read off a corpus is keyed and named by `name`.
 */
export interface Corpus {
  /** What SQL calls it, and what its cached reads are keyed under ({@link corpusKey}). */
  name: string;
  attachment: Attachment;
  /** The page's one engine, the corpus attached to it: what reads outside the coordinator's queue, as the Ask agent does. */
  engine: Engine;
}

/**
 * The attach, cached under {@link corpusKey}: every reader of one graph shares one attachment, and
 * it lives the way any cached read does. Each page that reads the corpus observes this query; when
 * the last one goes, the cache waits {@link CORPUS_GC_MS} and removes the entry, and its removal is
 * what detaches it (`releaseCorpora`, registered beside the app's query client). A page that unmounts does
 * not detach anything itself: Mosaic still runs what it queued on the way out — the re-queries a
 * withdrawn filter asks for, the pre-aggregator's tables — and those must find the corpus attached.
 *
 * While a page's children suspend on their own reads, React commits nothing of it, so nothing
 * observes the corpus then either and the timer runs. A short `gcTime` is only floored at 1 s by
 * useSuspenseQuery (`ensureSuspenseTimers`), and a corpus whose first draw took longer, as LDBC SNB's
 * 327.6K vertices do on a CI runner, would be collected and detached under its own readers. Minutes
 * are not that floor: a page whose first draw has not committed in five has failed already.
 */
export function corpusQuery(graphId: string) {
  return corpusOf(graphId, (attachedTo, signal) => attachJob(graphId, { engine: attachedTo, host, signal }));
}

/**
 * {@link corpusQuery}'s options, for any corpus: cached under `name`, attached by `attachTo` on the
 * page's engine, and given back as every corpus is (`releaseCorpora`).
 */
export function corpusOf(name: string, attachTo: (engine: Engine, signal: AbortSignal) => Promise<Attachment>) {
  return queryOptions({
    queryKey: corpusKey(name),
    queryFn: async ({ signal }): Promise<Corpus> => {
      const attachedTo = await engine({ signal });
      const attachment = await attachTo(attachedTo, signal);
      // The cache gave up on this attach while it was out — the entry removed, reset, or its last
      // reader gone — and drops what it resolves to, so no `removed` event will ever carry it.
      // `attachGraph` rejects on an abort only when a step fails, so one that ran to the end lands here:
      // it is given back now, or nothing ever would.
      // Nothing waits on this query any more, so a detach that fails is said here, by the failure path.
      if (signal.aborted) {
        await attachment.detach().catch((err: unknown) => toastError(err, RELEASE_FAILED));
        signal.throwIfAborted();
      }
      return { name, attachment, engine: attachedTo };
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
 * attached while the page is on screen, so every page that reads a graph's corpus reads it through
 * this.
 */
export function CorpusProvider({ graphId, children }: { graphId: string; children: ReactNode }) {
  const corpus = settled(useSuspenseQuery(corpusQuery(graphId)));
  return <CorpusScope corpus={corpus}>{children}</CorpusScope>;
}

/**
 * The graph's mapping, parsed (`mapping.ttl` beside it, by rudof's `Mapping`): what its tables mean
 * as RDF — classes, predicates, datatypes, labels — and the relation of triples the rules validate.
 * Read after the graph's first paint and not before: nothing on the graph page waits for rudof.
 */
export function mappingQuery(corpus: Corpus) {
  return queryOptions({
    queryKey: [...corpusKey(corpus.name), "mapping"],
    queryFn: async ({ signal }) => parseMapping(await corpus.attachment.mapping({ signal })),
    ...ONCE,
  });
}

/**
 * An attached corpus to everything under it — a graph's, or a preview's. The corpus's join graph is
 * read before the scope's `MosaicProvider`, which builds its one selection over it: a clause on one
 * relation reaches a part reading another. Suspends while the join graph is read; the graph is then
 * described by the mapping (`withMapping`) as soon as it is read, so the types, the relations and
 * the columns are called by their labels and a year is a time, and until then, or if it cannot be
 * read, by their names.
 */
export function CorpusScope({ corpus, children }: { corpus: Corpus; children: ReactNode }) {
  const plain = settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(corpus.name), "join-graph"],
      queryFn: () => readJoinGraph(corpus.engine.coordinator, corpus.name),
      ...ONCE,
    }),
  );
  const mapping = useQuery(mappingQuery(corpus));
  const failure = mapping.error;
  useEffect(() => {
    if (failure) toastError(failure, "The graph's labels could not be read");
  }, [failure]);
  const joins = useMemo(() => (mapping.data ? withMapping(plain, mapping.data.model()) : plain), [plain, mapping.data]);
  return (
    <CorpusContext value={corpus}>
      <MosaicProvider coordinator={corpus.engine.coordinator} joins={joins} onFailure={chartFailed}>
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

/** The column the graph keys a vertex by — GraphAr numbers vertices within a type, and the graph's own global id is the same in every vertex type. */
export function useGraphKey(): string {
  return useVerticesType().key;
}

/** The corpus's join graph — its types and the edges between them — the one the page's `MosaicProvider` holds. */
export function useJoinGraph(): JoinGraph {
  const { joins } = useMosaic();
  if (!joins) throw new Error("useJoinGraph must be used within CorpusProvider");
  return joins;
}

/**
 * Every vertex of the corpus as one relation — the join graph's `vertices`, kanzo-ui's union of every
 * vertex type: its key, its `subject` (the primary key, the IRI the mapping makes of it) and every
 * column the types share. It is what a selection on the graph filters whatever the type, so it is the
 * relation a panel scopes by: the Ask panel's subset count, and the rules' focus nodes read back as
 * vertices.
 */
function useVerticesType() {
  return useJoinGraph().types.find((t) => t.name === "vertices")!;
}

/** {@link useVerticesType}'s relation. */
export function useVertices(): TableExpr {
  return useVerticesType().table;
}
