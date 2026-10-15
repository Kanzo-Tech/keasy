"use client";

import { useParams } from "next/navigation";
// eslint-disable-next-line no-restricted-imports -- a footnote: a failed read of the graph's conversation leaves the Info panel as it was
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@kanzo-tech/ui";
import { $api } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { conversationQuery, decisionsOf, labelOf, toStored } from "@/lib/assistant-conversation";

/**
 * What the assistant decided about this graph, as a short list: each question, the option taken —
 * *Assumed* when it was a safe default nobody was asked about. A record, with no way to change it: a
 * built graph is written once (docs/design/assistant.md, *a built graph is written once*). The decisions are data parts of that conversation's messages
 * (`lib/assistant-conversation.ts`). Nothing for a graph the assistant did not build, nor while the
 * conversation is read: the list is a footnote, never a wait.
 */
export function GraphAssumptions() {
  const { id: graphId } = useParams<{ id: string }>();
  const graph = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", { params: { path: { id: graphId } } }));
  const conversation = graph.conversation ?? null;
  const read = useQuery({ ...conversationQuery(conversation ?? ""), enabled: conversation !== null, staleTime: Infinity });
  const decisions = read.data ? decisionsOf(toStored(read.data.messages)) : [];
  if (conversation === null || decisions.length === 0) return null;
  return (
    <section aria-label="Assumptions" className="mb-3 flex flex-col gap-1.5">
      <h3 className="font-medium text-muted-foreground text-xs">What I decided</h3>
      <ul className="flex flex-col gap-1">
        {decisions.map((taken) => (
          <li className="flex min-w-0 flex-col text-sm" key={taken.decision.id}>
            <span className="text-muted-foreground text-xs">{taken.decision.question}</span>
            <span className="flex items-center gap-1.5">
              {labelOf(taken)}
              {taken.assumed && (
                <Badge pill variant="outline">
                  Assumed
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
