"use client";

import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { JoinGraph } from "@kanzo-tech/mosaic";
import { useMosaic } from "@kanzo-tech/ui/analytics";
import { answerRelationsOf, readAnswerRelations, useAskChat, type AnswerRelation } from "@kanzo-tech/ai/data";
import { useModel } from "@/lib/ai";
import { settled } from "@/lib/api/settled";
import { corpusKey, ONCE, useCorpus, useJoinGraph } from "./corpus";

/**
 * What may be asked about a corpus, once per corpus: each type alone (`answerRelationsOf`, no hops —
 * the relation an answer needs is computed from its spec), its fields and their common values.
 */
function useAnswerRelations(graph: JoinGraph): AnswerRelation[] {
  const { name: corpus } = useCorpus();
  const { coordinator } = useMosaic();
  return settled(
    useSuspenseQuery({
      queryKey: [...corpusKey(corpus), "answer-relations"],
      queryFn: ({ signal }) => readAnswerRelations(coordinator, graph, answerRelationsOf(graph, { hops: 0 }), { signal }),
      ...ONCE,
    }),
  );
}

/**
 * Ask over the corpus in scope (`CorpusScope`): Discover's panel over a graph, and the assistant's
 * chat over its preview. `chat` is `useAskChat` on the page's model and engine under the scope's
 * selection; each `answer` part it holds is drawn as an `AnswerCard` over `graph`, and `over` is what
 * `AskChips` reads. Suspends while the corpus's types are read.
 */
export function useCorpusAsk() {
  const { selection } = useMosaic();
  const { engine } = useCorpus();
  const graph = useJoinGraph();
  const types = useAnswerRelations(graph);
  const model = useModel();
  const chat = useAskChat({ model, engine, graph, types, selection });
  const over = useMemo(() => ({ graph, types }), [graph, types]);
  return { chat, graph, types, over };
}
