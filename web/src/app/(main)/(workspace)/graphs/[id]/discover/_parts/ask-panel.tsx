"use client";

import { Suspense, useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { count, Query } from "@uwdata/mosaic-sql";
import { useChartQuery, useClauses, useMosaic, type JoinGraph } from "@kanzo-tech/ui/analytics";
import { Badge, EmptyDescription, EmptyHeader, EmptyIndicator, EmptyRoot } from "@kanzo-tech/ui";
import { Chat, ChatSkeleton, useAgentChat } from "@kanzo-tech/ai";
import { AnswerCard, answerRelationsOf, dataAgent, dataSuggestions, readAnswerRelations, type AnswerRelation } from "@kanzo-tech/ai/data";
import { problemCopy, ProblemView } from "@/components/problem-view";
import { gateway } from "@/lib/ai";
import { settled } from "@/lib/api/settled";
import { coded } from "@/lib/errors";
import { corpusKey, ONCE, useCorpus, useJoinGraph, useVertices } from "@/lib/fossil/corpus";
import { useDashboardStore } from "./dashboard-store";
import { startersQuery } from "./starters";

/**
 * The Ask panel — `@kanzo-tech/ai/data` over the graph: `readAnswerRelations` over the corpus's join
 * graph, `dataAgent` on the page's engine under the page's crossfilter, `dataSuggestions` as the
 * pills, and each answer an `AnswerCard` — the dashboard tile it is, which *Filter to it* narrows the
 * page to and *Add to the dashboard* adds to the Dashboard view's saved document. Nothing here
 * writes SQL, and neither does the model: it names a relation, conditions and a tile.
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
          Ask about the graph. Every answer is a tile over what is in view.
        </EmptyDescription>
      </EmptyHeader>
    </EmptyRoot>
  );
}

/**
 * What may be asked about, as the model reads it, once per graph: each type alone and through each
 * of its hops (`answerRelationsOf`, as the `RelationPicker` first offers them), their fields and their
 * common values.
 */
function useRelations(graph: JoinGraph): AnswerRelation[] {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "answer-relations"],
      queryFn: ({ signal }) => readAnswerRelations(coordinator, graph, answerRelationsOf(graph), { signal }),
      ...ONCE,
    }),
  );
}

/**
 * Questions to start from, cached per graph and per filter: a filter changed is a different question
 * to ask. Streamed, so the pills land one by one; a failure is drawn in their place, with a retry,
 * and the chat works the same. A few short questions are a completion: `gateway("complete")`.
 */
function useStarters(graph: JoinGraph, relations: readonly AnswerRelation[]) {
  const { graphId } = useCorpus();
  const { crossfilter } = useMosaic();
  // Re-rendered on every clause, so the key below is the filter as it is now.
  useClauses(crossfilter);
  const starters = useQuery({
    queryKey: [...corpusKey(graphId), "starters", String(crossfilter.predicate(null) ?? "")],
    // Each request replaces the last, and one cut short by a filter change leaves nothing behind.
    queryFn: startersQuery(({ signal }) =>
      dataSuggestions({ model: gateway("complete"), graph, relations, selection: crossfilter, abortSignal: signal }),
    ),
    staleTime: Infinity,
    retry: false,
  });
  return {
    suggesting: starters.fetchStatus === "fetching",
    proposals: starters.isError ? [] : (starters.data ?? []),
    failure: starters.isError && (
      <ProblemView className="w-full" error={starters.error} onRetry={() => void starters.refetch()} uncoded="llm/failed" />
    ),
  };
}

/**
 * *Add to the dashboard*, for whoever may edit it: the page's saved document, which the card reads
 * *✓ On the dashboard* off, and the write of the next one, which the card waits on and whose failure
 * it draws. Nothing while the document has not been read, or for a reader who may not change it.
 */
function useAdding() {
  const store = useDashboardStore();
  if (store.status !== "ready" || !store.edit) return {};
  return { dashboards: store.current, onAdd: store.edit.add };
}

/**
 * What the next question is asked over, in the composer: the subset's size while the page holds one,
 * and nothing while it does not — every question then reads the whole graph.
 */
function SubsetPill({ vertices }: { vertices: Query }) {
  const { crossfilter } = useMosaic();
  const { row } = useChartQuery({ deps: [vertices], query: (filter) => Query.from(vertices).select({ n: count() }).where(filter) });
  if (!row || crossfilter.clauses.length === 0) return null;
  return (
    <Badge pill variant="outline">
      Subset · {Number(row.n).toLocaleString()} nodes
    </Badge>
  );
}

function AskChat() {
  const { crossfilter } = useMosaic();
  const { engine } = useCorpus();
  const vertices = useVertices();
  const graph = useJoinGraph();
  const relations = useRelations(graph);
  const agent = useMemo(
    () => dataAgent({ model: gateway("chat"), engine, graph, relations, selection: crossfilter }),
    [engine, graph, relations, crossfilter],
  );
  const chat = useAgentChat(agent);
  const starters = useStarters(graph, relations);
  const adding = useAdding();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Chat
        // What stopped the answer, by its code: a silence or a spent budget as `@kanzo-tech/llm` names
        // it, and anything uncoded as `llm/failed`, in keasy's words.
        chat={{ ...chat, error: chat.error === undefined ? undefined : coded(chat.error, "llm/failed") }}
        copy={problemCopy}
        className="p-2"
        context={<SubsetPill vertices={vertices} />}
        empty={<AskEmpty />}
        notice={starters.failure}
        suggesting={starters.suggesting}
        suggestions={starters.proposals}
        tools={{
          answer: (part, { stopped }) => <AnswerCard copy={problemCopy} graph={graph} part={part} stopped={stopped} {...adding} />,
        }}
        translations={{ placeholder: "Ask about your data…" }}
      />
    </div>
  );
}
