"use client";

import { Suspense, useMemo } from "react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useClauses, useMosaic, type JoinGraph } from "@kanzo-tech/ui/analytics";
import { Badge, EmptyDescription, EmptyHeader, EmptyIndicator, EmptyRoot } from "@kanzo-tech/ui";
import { Chat, ChatSkeleton } from "@kanzo-tech/ai";
import {
  AnswerCard,
  answerRelationsOf,
  askEdit,
  AskChips,
  askOffers,
  readAnswerRelations,
  useAskChat,
  type AnswerRelation,
  type AskOutput,
} from "@kanzo-tech/ai/data";
import { problemCopy, ProblemView } from "@/components/problem-view";
import { ModelStatus } from "@/components/model-status";
import { useModel, useModelLoad } from "@/lib/ai";
import { settled } from "@/lib/api/settled";
import { coded } from "@/lib/errors";
import { corpusKey, ONCE, useCorpus, useJoinGraph } from "@/lib/fossil/corpus";
import { useDashboardStore } from "./dashboard-store";

/**
 * The Ask panel — `@kanzo-tech/ai/data` over the graph: each type of the corpus's join graph read
 * alone (`readAnswerRelations`), each question one run of the `ask` Task on the page's engine under
 * the page's one selection (`useAskChat`), its own checked offers as the pills (`askOffers`), and each
 * answer an `AnswerCard` — the dashboard tile it is, which *Filter the page to these rows* narrows the
 * page to (when it filters at all), *Add to the dashboard* adds to the Dashboard view's saved
 * document, and *Open on the dashboard* then shows there — with `AskChips` under it, each part of
 * what the answer was read as, open to its checked alternatives and asked again with no model.
 * Nothing here writes SQL, and neither does the model: it fills a spec, and the relation is computed.
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
 * What may be asked about, once per graph: each type alone (`answerRelationsOf`, no hops — the relation
 * an answer needs is computed from its spec), its fields and their common values.
 */
function useRelations(graph: JoinGraph): AnswerRelation[] {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "answer-relations"],
      queryFn: ({ signal }) => readAnswerRelations(coordinator, graph, answerRelationsOf(graph, { hops: 0 }), { signal }),
      ...ONCE,
    }),
  );
}

/**
 * Questions to start from, cached per graph and per filter: a filter changed is a different question
 * to ask. Ask's own offers, each checked before it is shown, so every pill is one the chat answers. A
 * failure is drawn in their place, with a retry, and the chat works the same.
 */
function useStarters(graph: JoinGraph, types: readonly AnswerRelation[]) {
  const { graphId } = useCorpus();
  const { selection } = useMosaic();
  const model = useModel();
  // Asked once the model is ready: offers are not worth waiting on its download for.
  const ready = useModelLoad().state === "ready";
  // Re-rendered on every clause, so the key below is the filter as it is now.
  useClauses(selection);
  const starters = useQuery({
    queryKey: [...corpusKey(graphId), "starters", String(selection.predicate(null) ?? "")],
    queryFn: ({ signal }) => askOffers({ model, graph, types, selection, signal }),
    staleTime: Infinity,
    retry: false,
    enabled: ready,
  });
  return {
    proposing: starters.fetchStatus === "fetching",
    proposals: starters.isError ? [] : (starters.data ?? []).map(({ text }) => ({ text })),
    failure: starters.isError && (
      <ProblemView className="w-full" error={starters.error} onRetry={() => void starters.refetch()} uncoded="llm/failed" />
    ),
  };
}

/**
 * *Add to the dashboard*, for whoever may edit it: the page's saved document, which the card reads
 * whether the tile is there off, the write of the next one, which the card waits on and whose
 * failure it draws, and *Open on the dashboard* once it is there. Nothing while the document has not
 * been read, or for a reader who may not change it.
 */
function useAdding() {
  const store = useDashboardStore();
  if (store.status !== "ready" || !store.edit) return {};
  return { dashboards: store.current, onAdd: store.edit.add, onOpen: store.edit.open };
}

/**
 * What the next question is asked over, in the composer: *Filtered* while the page holds a filter,
 * and nothing while it does not — every question then reads the whole graph. Not how many: that is
 * the page's one count, the filter bar's readout.
 */
function SubsetPill() {
  const { selection } = useMosaic();
  if (useClauses(selection).length === 0) return null;
  return (
    <Badge pill variant="outline">
      Filtered
    </Badge>
  );
}

function AskChat() {
  const { selection } = useMosaic();
  const { engine } = useCorpus();
  const graph = useJoinGraph();
  const types = useRelations(graph);
  // The download started when the graph opened (`usePreloadModel`); the panel says how it stands.
  const load = useModelLoad();
  const model = useModel();
  const chat = useAskChat({ model, engine, graph, types, selection });
  const over = useMemo(() => ({ graph, types }), [graph, types]);
  const starters = useStarters(graph, types);
  const adding = useAdding();

  return (
    // `data-model`: how the model's load stands, which a harness waits on before it asks.
    <div className="flex h-full min-h-0 flex-col" data-model={load.state}>
      <Chat
        // What stopped the answer, by its code as `@kanzo-tech/llm` names it, and anything uncoded as
        // `llm/failed`, in keasy's words.
        chat={{ ...chat, error: chat.error === undefined ? undefined : coded(chat.error, "llm/failed") }}
        copy={problemCopy}
        className="p-2"
        context={<SubsetPill />}
        empty={<AskEmpty />}
        notice={load.state === "ready" ? starters.failure : <ModelStatus />}
        proposing={starters.proposing}
        proposals={starters.proposals}
        tools={{
          answer: (part, { stopped }) => {
            // What the answer was read as, each part a chip: taking one asks the edited spec, no model.
            const spec = part.state === "output-available" ? (part.output as AskOutput).spec : undefined;
            return (
              <div className="flex flex-col gap-2">
                <AnswerCard copy={problemCopy} graph={graph} part={part} stopped={stopped} {...adding} />
                {spec && <AskChips onChange={(next) => void chat.sendMessage(askEdit(next))} over={over} spec={spec} />}
              </div>
            );
          },
        }}
        translations={{ placeholder: "Ask about your data…" }}
      />
    </div>
  );
}
