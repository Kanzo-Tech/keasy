"use client";

import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
// eslint-disable-next-line no-restricted-imports -- the mapping describes the graph after its first paint; a mapping that cannot be read leaves the graph in the names its tables have
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { engine, type Engine } from "@kanzo-tech/mosaic/engine";
import type { TableExpr } from "@kanzo-tech/mosaic";
import { readJoinGraph, withMapping, type JoinGraph, type MappingModel } from "@kanzo-tech/relations";
import { MosaicProvider, useMosaic } from "@kanzo-tech/ui/analytics";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { type Attachment, attachJob } from "@/lib/fossil/attach";
import { graphKey, RELEASE_FAILED } from "@/lib/fossil/graph-cache";
import { host } from "@/lib/fossil/host";
import { parseMapping } from "@/lib/fossil/rudof";

/** Everything read off a graph is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

export { graphKey };

/**
 * How long a graph stays attached once nothing observes it: TanStack Query's own default. Long
 * enough that whatever its last page left queued on the engine has run, and that a page opened again
 * soon reuses it; short enough that a graph nobody reads gives its memory back.
 */
export const GRAPH_GC_MS = 5 * 60_000;

/**
 * A graph attached under {@link AttachedGraph.name} to the page's one engine: a graph's output, GraphAr's
 * `attachGraph` over the credential {@link host} vends for it (`lib/fossil/attach.ts`) — or the
 * assistant's preview, answered in memory (`lib/fossil/preview.ts`). SQL names it
 * `"<name>"."<Type>"`, and what it holds is its `graphar_*` relations, asked through the engine
 * by whoever needs to know; what its tables mean is `mapping.ttl` beside it (`mappingQuery`).
 * Everything read off a graph is keyed and named by `name`.
 */
export interface AttachedGraph {
  /** What SQL calls it, and what its cached reads are keyed under ({@link graphKey}). */
  name: string;
  attachment: Attachment;
  /** The page's one engine, the graph attached to it: what the charts, the graph and the Ask agent read through. */
  engine: Engine;
}

/**
 * The attach, cached under {@link graphKey}: every reader of one graph shares one attachment, and
 * it lives the way any cached read does. Each page that reads the graph observes this query; when
 * the last one goes, the cache waits {@link GRAPH_GC_MS} and removes the entry, and its removal is
 * what detaches it (`releaseGraphs`, registered beside the app's query client). A page that unmounts does
 * not detach anything itself: Mosaic still runs what it queued on the way out — the re-queries a
 * withdrawn filter asks for, the pre-aggregator's tables — and those must find the graph attached.
 *
 * While a page's children suspend on their own reads, React commits nothing of it, so nothing
 * observes the graph then either and the timer runs. A short `gcTime` is only floored at 1 s by
 * useSuspenseQuery (`ensureSuspenseTimers`), and a graph whose first draw took longer, as LDBC SNB's
 * 327.6K vertices do on a CI runner, would be collected and detached under its own readers. Minutes
 * are not that floor: a page whose first draw has not committed in five has failed already.
 */
export function graphQuery(graphId: string) {
  return graphOf(graphId, (attachedTo, signal) => attachJob(graphId, { engine: attachedTo, host, signal }));
}

/**
 * {@link graphQuery}'s options, for any graph: cached under `name`, attached by `attachTo` on the
 * page's engine, and given back as every graph is (`releaseGraphs`).
 */
export function graphOf(name: string, attachTo: (engine: Engine, signal: AbortSignal) => Promise<Attachment>) {
  return queryOptions({
    queryKey: graphKey(name),
    queryFn: async ({ signal }): Promise<AttachedGraph> => {
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
    gcTime: GRAPH_GC_MS,
  });
}

const GraphContext = createContext<AttachedGraph | null>(null);

/**
 * A chart, stat or filter whose query failed draws the failure in its own frame; what was thrown
 * is said once more, by its code, through the toast path every failed action takes.
 */
function chartFailed(error: unknown) {
  toastError(error, "A chart could not be drawn");
}

/**
 * `graphId`'s graph to everything under it, opened here: suspends while it attaches, and throws to
 * the nearest boundary if it cannot. Its observer of {@link graphQuery} is what keeps the graph
 * attached while the page is on screen, so every page that reads a graph's output reads it through
 * this.
 */
export function GraphProvider({ graphId, children }: { graphId: string; children: ReactNode }) {
  const graph = settled(useSuspenseQuery(graphQuery(graphId)));
  return <GraphScope graph={graph}>{children}</GraphScope>;
}

/**
 * The graph's mapping, parsed (`mapping.ttl` beside it, by rudof's `Mapping`): what its tables mean
 * as RDF — classes, predicates, datatypes, labels — and the relation of triples the rules validate.
 * Read after the graph's first paint and not before: nothing on the graph page waits for rudof.
 */
export function mappingQuery(graph: AttachedGraph) {
  return queryOptions({
    queryKey: [...graphKey(graph.name), "mapping"],
    queryFn: async ({ signal }) => parseMapping(await graph.attachment.mapping({ signal })),
    ...ONCE,
  });
}

/**
 * An attached graph to everything under it — a graph's, or a preview's. The graph's join graph is
 * read before the scope's `MosaicProvider`, which builds its one selection over it: a clause on one
 * relation reaches a part reading another. Suspends while the join graph is read; the graph is then
 * described by the mapping (`withMapping`) as soon as it is read, so the types, the relations and
 * the columns are called by their labels and a year is a time, and until then, or if it cannot be
 * read, by their names.
 */
export function GraphScope({ graph, children }: { graph: AttachedGraph; children: ReactNode }) {
  const plain = settled(
    useSuspenseQuery({
      queryKey: [...graphKey(graph.name), "join-graph"],
      queryFn: ({ signal }) => readJoinGraph(graph.engine, graph.name, { signal }),
      ...ONCE,
    }),
  );
  const mapping = useQuery(mappingQuery(graph));
  const failure = mapping.error;
  useEffect(() => {
    if (failure) toastError(failure, "The graph's labels could not be read");
  }, [failure]);
  const joins = useMemo(() => (mapping.data ? withMapping(plain, mapping.data.model()) : plain), [plain, mapping.data]);
  return (
    <GraphContext value={graph}>
      <MosaicProvider engine={graph.engine} joins={joins} onFailure={chartFailed}>
        {children}
      </MosaicProvider>
    </GraphContext>
  );
}

/**
 * What the graph's mapping states, as `withMapping` and `GraphRoot` read it (rudof's `Mapping.model()`):
 * `undefined` until it is read, and if it cannot be, so the graph draws without waiting on rudof.
 */
export function useMappingModel(): MappingModel | undefined {
  const { data } = useQuery(mappingQuery(useAttachedGraph()));
  return useMemo(() => data?.model(), [data]);
}

export function useAttachedGraph(): AttachedGraph {
  const graph = use(GraphContext);
  if (!graph) throw new Error("useAttachedGraph must be used within GraphProvider");
  return graph;
}

/** The column the graph keys a vertex by — GraphAr numbers vertices within a type, and the graph's own global id is the same in every vertex type. */
export function useGraphKey(): string {
  return useVerticesType().key;
}

/** The graph's join graph — its types and the edges between them — the one the page's `MosaicProvider` holds. */
export function useJoinGraph(): JoinGraph {
  const { joins } = useMosaic();
  if (!joins) throw new Error("useJoinGraph must be used within GraphProvider");
  return joins;
}

/**
 * Every vertex of the graph as one relation — the join graph's `vertices`, kanzo-ui's union of every
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
