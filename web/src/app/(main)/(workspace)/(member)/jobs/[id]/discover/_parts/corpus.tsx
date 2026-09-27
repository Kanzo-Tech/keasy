"use client";

import { createContext, use, type ReactNode } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { SchemaResult, SqlCorpus } from "@fossil-lang/corpus";
import { MosaicProvider, engine, type Coordinator } from "@kanzo-tech/ui/analytics";
import { queryClient } from "@/lib/api/query-client";
import { corpusKey, openJobCorpus } from "@/lib/fossil/corpus";

/** Everything read off a corpus is read once, and dropped with the page. */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

export interface Corpus {
  jobId: string;
  coordinator: Coordinator;
  corpus: SqlCorpus;
  /** What the schema verb answered at boot. */
  schema: SchemaResult;
  /** A relation's name as SQL reads it: `"jobs/7"."Person"`, in the corpus's own catalog. */
  relation: (name: string) => string;
}

export function corpusQuery(jobId: string) {
  return queryOptions({
    queryKey: corpusKey(jobId),
    queryFn: async (): Promise<Corpus> => {
      const [{ coordinator }, corpus] = await Promise.all([engine(), openJobCorpus(jobId)]);
      const [schema, relations] = await Promise.all([corpus.schema(), corpus.relations()]);
      const sql = new Map(relations.map((r) => [r.name, r.sql]));
      const relation = (name: string) => {
        const found = sql.get(name);
        if (found === undefined) throw new Error(`The corpus has no relation ${name}`);
        return found;
      };
      return { jobId, coordinator, corpus, schema, relation };
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

export function CorpusProvider({ value, children }: { value: Corpus; children: ReactNode }) {
  return (
    <CorpusContext value={value}>
      <MosaicProvider coordinator={value.coordinator}>{children}</MosaicProvider>
    </CorpusContext>
  );
}

export function useCorpus(): Corpus {
  const corpus = use(CorpusContext);
  if (!corpus) throw new Error("useCorpus must be used within CorpusProvider");
  return corpus;
}

/** The boot schema with every type's field statistics (`stats`) once they land; empty until then. */
export function useGraphSchema(): { schema: SchemaResult; error: Error | null } {
  const { jobId, corpus, schema } = useCorpus();
  const stats = useQuery({
    queryKey: [...corpusKey(jobId), "stats"],
    queryFn: () => corpus.schema({ stats: true }),
    ...ONCE,
  });
  return { schema: stats.data ?? schema, error: stats.error };
}

/** One vertex type's field statistics. */
export const fieldsOf = (schema: SchemaResult, type: string) =>
  schema.vertices.find((v) => v.name === type)?.stats ?? [];
