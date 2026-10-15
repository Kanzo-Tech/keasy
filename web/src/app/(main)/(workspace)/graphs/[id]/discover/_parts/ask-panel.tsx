"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
// eslint-disable-next-line no-restricted-imports -- suggested questions: a failure leaves no pills, and the chat works the same
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { JoinGraph } from "@kanzo-tech/relations";
import { useClauses, useMosaic } from "@kanzo-tech/ui/analytics";
import { Badge, EmptyDescription, EmptyHeader, EmptyIndicator, EmptyRoot } from "@kanzo-tech/ui";
import { Chat, ChatSkeleton } from "@kanzo-tech/ai";
import { askEdit, askOffers } from "@kanzo-tech/ai/data";
import { askParts } from "@/components/ask-parts";
import { describeProblem, ProblemView } from "@/components/problem-view";
import { ModelStatus } from "@/components/model-status";
import { useModel, useModelLoad } from "@/lib/ai";
import { coded } from "@/lib/errors";
import { useGraphAsk } from "@/lib/fossil/ask";
import { graphKey, useAttachedGraph } from "@/lib/fossil/graph";
import { hasAsked, isHanded, useHandedQuestion } from "./ask-handoff";
import { useDashboardStore } from "./dashboard-store";

/**
 * The Ask panel — `@kanzo-tech/ai/data` over the graph (`useGraphAsk`, which the assistant's chat
 * reads its preview through too): the catalog's join graph and what it holds, each question one run of the `ask` Task on the page's engine under
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
 * Questions to start from, cached per graph and per filter: a filter changed is a different question
 * to ask. Ask's own offers, each checked before it is shown, so every pill is one the chat answers. A
 * failure is drawn in their place, with a retry, and the chat works the same.
 *
 * **They yield to the person's question.** The model takes its calls in turn, so an offer being
 * generated is a wait in front of whatever the person asks: once a question is theirs — typed and sent,
 * or handed over by the assistant — none starts and the one in flight is stopped (`hasAsked`).
 */
function useStarters(graph: JoinGraph, asked: boolean) {
  const { name: catalog } = useAttachedGraph();
  const { selection } = useMosaic();
  const model = useModel();
  const queryClient = useQueryClient();
  // Asked once the model is ready: offers are not worth waiting on its download for.
  const ready = useModelLoad().state === "ready";
  // Re-rendered on every clause, so the key below is the filter as it is now.
  useClauses(selection);
  const queryKey = [...graphKey(catalog), "starters", String(selection.predicate(null) ?? "")];
  const starters = useQuery({
    queryKey,
    queryFn: ({ signal }) => askOffers({ model, graph, selection, signal }),
    staleTime: Infinity,
    retry: false,
    enabled: ready && !asked,
  });
  // Disabling a query leaves its fetch running; stopping it is what hands the model to the question.
  useEffect(() => {
    if (asked) void queryClient.cancelQueries({ queryKey: [...graphKey(catalog), "starters"] });
  }, [asked, catalog, queryClient]);
  return {
    proposing: starters.fetchStatus === "fetching",
    proposals: starters.isError ? [] : (starters.data ?? []),
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
  const { chat, graph } = useGraphAsk();
  // The download started when the graph opened (`usePreloadModel`); the badge says how it stands.
  const load = useModelLoad();
  // The question the assistant handed over (`?q=`), asked once the model is ready.
  const { sendMessage } = chat;
  useHandedQuestion(useCallback((text: string) => void sendMessage({ text }), [sendMessage]), load.state === "ready");
  // Read before `useHandedQuestion` takes it off the URL: a question handed over is the person's.
  const [handed] = useState(isHanded);
  const asked = hasAsked({ handed, messages: chat.messages.length, status: chat.status });
  const starters = useStarters(graph, asked);
  const adding = useAdding();

  return (
    // `data-model`: how the model's load stands, which a harness waits on before it asks.
    <div className="flex h-full min-h-0 flex-col" data-model={load.state}>
      <Chat
        // What stopped the answer, by its code as `@kanzo-tech/llm` names it, and anything uncoded as
        // `llm/failed`, in keasy's words.
        chat={{ ...chat, error: chat.error === undefined ? undefined : coded(chat.error, "llm/failed") }}
        describe={describeProblem}
        className="p-2"
        // Each answer the dashboard tile it is, with its chips; a decision Ask needs, as a question.
        data={askParts({ graph, send: (message) => void sendMessage(message), adding })}
        context={
          <>
            <ModelStatus />
            <SubsetPill />
          </>
        }
        empty={<AskEmpty />}
        // An offer is sent as Ask's spec, as it is: a starter is not re-asked of the model.
        message={askEdit}
        // The offers ask the model: until it is ready, the badge says why there are none.
        notice={load.state === "ready" ? starters.failure : undefined}
        proposing={starters.proposing}
        proposals={starters.proposals}
        translations={{ placeholder: "Ask about your data…" }}
      />
    </div>
  );
}
