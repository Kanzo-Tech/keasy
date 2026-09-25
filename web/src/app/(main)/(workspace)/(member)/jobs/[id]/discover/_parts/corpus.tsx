"use client";

import { createContext, use, type ReactNode } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { SchemaResult, SqlCorpus } from "@fossil-lang/corpus";
import { MosaicProvider, type Coordinator } from "@kanzo-tech/ui/analytics";
import { corpusKey, openJobCorpus } from "@/lib/fossil/corpus";

/**
 * Everything read off a corpus is read once and dropped with the page: the signed URLs behind it
 * expire, so a cached corpus outliving the visit would be one that can no longer read its files.
 */
/** The root of everything read off one job's corpus: local reads, never the API's cache. */

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
    queryKey: corpusKey(jobId),
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
