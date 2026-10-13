"use client";

import { useParams } from "next/navigation";
import { Link } from "@kanzo-tech/navigation/next";
import { Badge, Button } from "@kanzo-tech/ui";
import { $api } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { decisionsOf, labelOf } from "@/lib/assumptions";

/** The assistant opened on graph `graphId` with decision `decision` to take again. */
export const changeHref = (graphId: string, decision: string) =>
  `/graphs/new/assistant?graph=${encodeURIComponent(graphId)}&decision=${encodeURIComponent(decision)}`;

/**
 * What the assistant decided about this graph, as a short list: each question, the option taken —
 * *Assumed* when it was a safe default nobody was asked about — and **Change**, which takes the
 * decision again in the assistant and builds the graph again (docs/design/assistant.md, *assumptions
 * instead of blocks*). The decisions travel in the graph's program (`lib/assumptions.ts`). Nothing for
 * a graph the assistant did not build.
 */
export function GraphAssumptions() {
  const { id: graphId } = useParams<{ id: string }>();
  const graph = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", { params: { path: { id: graphId } } }));
  const decisions = decisionsOf(graph.script);
  if (decisions.length === 0) return null;
  return (
    <section aria-label="Assumptions" className="mb-3 flex flex-col gap-1.5">
      <h3 className="font-medium text-muted-foreground text-xs">What I decided</h3>
      <ul className="flex flex-col gap-1">
        {decisions.map((taken) => (
          <li className="flex items-start gap-2 text-sm" key={taken.decision.id}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-muted-foreground text-xs">{taken.decision.question}</span>
              <span className="flex items-center gap-1.5">
                {labelOf(taken)}
                {taken.assumed && (
                  <Badge pill variant="outline">
                    Assumed
                  </Badge>
                )}
              </span>
            </span>
            <Button asChild size="sm" variant="ghost">
              <Link href={changeHref(graphId, taken.decision.id)}>Change</Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
