"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { TableRefNode, column, eq, literal } from "@uwdata/mosaic-sql";
import { mapping, open, type Close } from "@fossil-lang/corpus";
import { mount } from "@fossil-lang/storage";
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

/** The root of every cached read of a graph's opened output; its own, so invalidating a graph never reopens it. */
export const corpusKey = (graphId: string) => ["corpus", graphId] as const;

/**
 * A graph's corpus, attached under its id to the page's one engine by fossil's `open`, which asks
 * {@link host} for the read credential: SQL names it `"<graphId>"."<Table>"`, and what it holds is its
 * `fossil_tables` and `fossil_columns`, asked through the coordinator by whoever needs to know.
 */
export interface Corpus {
  graphId: string;
  /** Detaches the corpus. */
  close: Close;
}

/** The corpus, and the coordinator of the engine it was attached to — the one `MosaicProvider` hands down. */
type Opened = Corpus & { coordinator: Coordinator };

export function corpusQuery(graphId: string) {
  return queryOptions({
    queryKey: corpusKey(graphId),
    queryFn: async ({ signal }): Promise<Opened> => {
      const attachedTo = await engine({ signal });
      const close = await open(graphId, { engine: attachedTo, host, signal });
      return { graphId, close, coordinator: attachedTo.coordinator };
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

/**
 * The IRIs the corpus's RDF reading is written in, as its manifest declares them: the classes of its
 * vertex types, and the predicates of its columns and relations — what a rule may target and check.
 */
export function useVocabulary(): { classes: string[]; properties: string[] } {
  const { graphId } = useCorpus();
  const tables = new TableRefNode([graphId, "fossil_tables"]);
  const columns = new TableRefNode([graphId, "fossil_columns"]);
  const rows = useQueryRows<{ term: "class" | "property"; iri: string }>(
    `SELECT DISTINCT CASE kind WHEN 'vertex' THEN 'class' ELSE 'property' END AS term, iri FROM ${tables} WHERE iri IS NOT NULL
     UNION SELECT 'property' AS term, iri FROM ${columns} WHERE iri IS NOT NULL AND role IS NULL
     ORDER BY iri`,
  );
  return useMemo(
    () => ({
      classes: rows.filter((r) => r.term === "class").map((r) => r.iri),
      properties: rows.filter((r) => r.term === "property").map((r) => r.iri),
    }),
    [rows],
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

/**
 * The corpus's RDF meaning, as fossil's RML mapping of its `fossil.json`. The manifest is read under
 * the same read credential `open` mounted, through the page's engine.
 */
export function useCorpusMapping(): string {
  const { graphId } = useCorpus();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "mapping"],
      queryFn: async ({ signal }) => {
        const attachedTo = await engine({ signal });
        const mounted = await mount(attachedTo, host, { job: graphId }, "read", { signal });
        try {
          const [manifest] = await mounted.files(mounted.prefixes.map((prefix) => `${prefix}${MANIFEST}`));
          const text = await attachedTo.query(`SELECT content FROM read_text(${literal(manifest)})`, { signal });
          return mapping(String(text.getChild("content")?.get(0)));
        } finally {
          await mounted.close();
        }
      },
      ...ONCE,
    }),
  );
}

/** The file a corpus is described by. */
const MANIFEST = "fossil.json";
