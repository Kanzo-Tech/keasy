"use client";

import { Suspense, useMemo, useState } from "react";
import { experimental_streamedQuery as streamedQuery, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { FilterIcon, Sparkles } from "lucide-react";
import { clauseSemiJoin, useClauses, useMosaic, type Selection } from "@kanzo-tech/ui/analytics";
import { corpusReferences, GraphSelect } from "@kanzo-tech/graph";
import { Button, EmptyDescription, EmptyHeader, EmptyIndicator, EmptyRoot } from "@kanzo-tech/ui";
import { Chat, ChatSkeleton, useAgentChat } from "@kanzo-tech/ai";
import {
  dataAgent,
  dataSuggestions,
  describeSchema,
  QueryResult,
  type DataSchema,
  type DataScope,
  type QueryOutput,
} from "@kanzo-tech/ai/data";
import { problemCopy } from "@/components/problem-view";
import { gateway } from "@/lib/ai";
import { settled } from "@/lib/api/settled";
import { coded } from "@/lib/errors";
import { corpusKey, ONCE, useCorpus, useGraphKey, useVertices } from "@/lib/fossil/corpus";

/**
 * The Ask panel — `@kanzo-tech/ai/data` over the graph: `describeSchema` with the joins the corpus
 * declares (`corpusReferences`), `dataAgent` on the page's coordinator under the page's selection,
 * `dataSuggestions` as the pills, and each answer a `QueryResult` whose actions take it back to the
 * page. Nothing here writes SQL; the panel only says what the page is.
 */
export function AskPanel() {
  return (
    <Suspense fallback={<ChatSkeleton className="p-2" empty={<AskEmpty />} />}>
      <AskChat />
    </Suspense>
  );
}

function AskEmpty() {
  return (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyIndicator>
          <Sparkles />
        </EmptyIndicator>
        <EmptyDescription className="text-xs">
          Ask about the graph. Every answer is a query over what is in view.
        </EmptyDescription>
      </EmptyHeader>
    </EmptyRoot>
  );
}

/** The catalog as the model reads it, once per graph: the corpus's own tables, and the joins only it knows. */
function useSchema(): DataSchema {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "schema"],
      queryFn: async ({ signal }) =>
        describeSchema(coordinator, {
          catalog: graphId,
          exclude: ["fossil_tables", "fossil_columns"],
          references: await corpusReferences(coordinator, graphId),
          signal,
        }),
      ...ONCE,
    }),
  );
}

/**
 * Questions to start from, cached per graph and per scope: a filter changed is a different question
 * to ask. Streamed, so the pills land one by one; a failure leaves none, and the chat works the same.
 */
function useStarters(schema: DataSchema, scope: DataScope) {
  const { graphId } = useCorpus();
  // Re-rendered on every clause, so the key below is the scope as it is now.
  useClauses(scope.selection);
  const starters = useQuery({
    queryKey: [...corpusKey(graphId), "starters", String(scope.selection.predicate(null) ?? "")],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => dataSuggestions({ model: gateway("chat"), schema, scope, abortSignal: signal }),
    }),
    staleTime: Infinity,
    retry: false,
  });
  return {
    suggesting: starters.fetchStatus === "fetching",
    proposals: starters.isError ? [] : (starters.data ?? []),
  };
}

/**
 * An answer that carries the graph's key, taken back to the page: its vertices on the canvas, or the
 * page filtered to them — a semi-join on identity, so the graph, the dashboard and the rules follow.
 */
function AnswerActions({ answer, crossfilter, source }: { answer: QueryOutput; crossfilter: Selection; source: object }) {
  const key = useGraphKey();
  if (!answer.rows[0] || !(key in answer.rows[0])) return null;
  const ids = [...new Set(answer.rows.map((row) => Number(row[key])).filter(Number.isFinite))];
  return (
    <>
      <GraphSelect disabled={ids.length === 0} label={answer.sql} load={async () => ids}>
        <span className="text-xs">Show on graph</span>
      </GraphSelect>
      <Button
        disabled={ids.length === 0}
        onClick={() => crossfilter.update(clauseSemiJoin(key, ids, { source, label: "Ask" }))}
        size="sm"
        variant="ghost"
      >
        <FilterIcon />
        Filter to these
      </Button>
    </>
  );
}

function AskChat() {
  const { coordinator, crossfilter } = useMosaic();
  const key = useGraphKey();
  const vertices = useVertices();
  const schema = useSchema();
  const scope = useMemo<DataScope>(() => ({ selection: crossfilter, table: vertices }), [crossfilter, vertices]);
  const agent = useMemo(
    () => dataAgent({ model: gateway("chat"), coordinator, schema, scope, key }),
    [coordinator, schema, scope, key],
  );
  const chat = useAgentChat(agent);
  const starters = useStarters(schema, scope);
  // What a reset of the crossfilter calls back, and what retracts the clause an answer published.
  const [source] = useState(() => ({ reset: () => {} }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Chat
        // What stopped the answer, by its code: a silence or a spent budget as `@kanzo-tech/llm` names
        // it, and anything uncoded as `llm/failed`, in keasy's words.
        chat={{ ...chat, error: chat.error === undefined ? undefined : coded(chat.error, "llm/failed") }}
        copy={problemCopy}
        className="p-2"
        empty={<AskEmpty />}
        suggesting={starters.suggesting}
        suggestions={starters.proposals}
        tools={{
          query: (part, { stopped }) => (
            <QueryResult
              actions={(answer) => <AnswerActions answer={answer} crossfilter={crossfilter} source={source} />}
              part={part}
              stopped={stopped}
            />
          ),
        }}
        translations={{ placeholder: "Ask about your data…" }}
      />
    </div>
  );
}
