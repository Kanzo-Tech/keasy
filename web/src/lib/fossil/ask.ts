"use client";

import { useMemo } from "react";
import { useMosaic } from "@kanzo-tech/ui/analytics";
import { useAskChat } from "@kanzo-tech/ai/data";
import { useModel } from "@/lib/ai";
import { useAttachedGraph, useJoinGraph } from "./graph";

/**
 * Ask over the graph in scope (`GraphScope`): Discover's panel over a graph, and the assistant's
 * chat over its preview. `chat` is `useAskChat` on the page's model and engine under the scope's
 * selection, offered the graph alone — its types and fields, and what each holds, are the graph's
 * (`readJoinGraph`). Each `data-answer` part is drawn as an `AnswerCard` over `graph`, and `over` is
 * what `AskChips` reads. Suspends while its join graph is read.
 */
export function useGraphAsk() {
  const { selection } = useMosaic();
  const { engine } = useAttachedGraph();
  const graph = useJoinGraph();
  const model = useModel();
  const chat = useAskChat({ model, engine, graph, selection });
  const over = useMemo(() => ({ graph }), [graph]);
  return { chat, graph, over };
}
