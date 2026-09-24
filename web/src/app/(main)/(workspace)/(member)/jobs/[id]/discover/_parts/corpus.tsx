"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { SchemaResult, SqlCorpus } from "@fossil-lang/corpus";
import { MosaicProvider, type Coordinator } from "@kanzo-tech/ui/analytics";
import { openJobCorpus } from "@/lib/fossil/open-job-corpus";
import { buildGraphSchema, type GraphSchema } from "@/lib/graph-schema";
import { queryKeys } from "@/lib/query-keys";

/**
 * Everything read off a corpus is read once and dropped with the page: the signed URLs behind it
 * expire, so a cached corpus outliving the visit would be one that can no longer read its files.
 */
export const ONCE = { staleTime: Infinity, gcTime: 0, retry: false } as const;

export interface Corpus {
  jobId: string;
  coordinator: Coordinator;
  corpus: SqlCorpus;
  /** What the schema verb answered at boot. */
  schema: SchemaResult;
  /** The manifests fossil named, kept so a canvas can address a type without refetching. */
  manifestFiles: Record<string, string>;
}

export function corpusQuery(jobId: string) {
  return queryOptions({
    queryKey: queryKeys.corpus(jobId),
    queryFn: async (): Promise<Corpus> => {
      const opened = await openJobCorpus(jobId);
      // Also what boots the verb transport, which registers the relations every chart and rule
      // in this surface queries by name.
      return { jobId, ...opened, schema: await opened.corpus.schema() };
    },
    ...ONCE,
  });
}

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

/**
 * The boot schema refined with datatype and role — one `schema({ vertex_type })` call per type,
 * one query per type instead of one per column. The name-only schema stands until those land.
 */
export function useGraphSchema(): { schema: GraphSchema; error: Error | null } {
  const { jobId, corpus, schema } = useCorpus();
  const stats = useQuery({
    queryKey: [...queryKeys.corpus(jobId), "stats"],
    queryFn: async () =>
      new Map(
        await Promise.all(
          schema.vertices.map(
            async (v) => [v.name, (await corpus.schema({ vertex_type: v.name })).fields] as const,
          ),
        ),
      ),
    ...ONCE,
  });
  const refined = useMemo(() => buildGraphSchema(schema, stats.data), [schema, stats.data]);
  return { schema: refined, error: stats.error };
}
