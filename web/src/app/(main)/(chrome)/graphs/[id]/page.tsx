"use client";

import { use } from "react";
import { Skeleton } from "@kanzo-tech/ui";
import { runProblem } from "@/lib/graphs";
import { lower, WORDS } from "@/lib/vocabulary";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";
import { Overview } from "./_parts/overview";
import { useGraph } from "./_parts/use-graph";

/**
 * The graph's one page: why its last run failed, if it did, and what its output holds once a run
 * completes. Explore is the header's action, the one way in.
 */
export default function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const graph = useGraph(id);
  const problem = runProblem(graph);
  return (
    <div className="flex flex-col gap-8">
      {problem && <ProblemView error={problem} />}
      {graph.status === "completed" ? (
        <Boundary
          fallback={
            <Loading>
              <Skeleton className="h-96 w-full" />
            </Loading>
          }
        >
          <Overview graph={graph} />
        </Boundary>
      ) : (
        <p className="text-muted-foreground text-sm">
          {graph.status === "draft"
            ? `A draft is not run: edit its ${lower(WORDS.recipe)}, then create it.`
            : graph.started_at
              ? `What the ${lower(WORDS.output)} holds shows once a ${lower(WORDS.run)} completes.`
              : `Never run. ${WORDS.run} it to write its ${lower(WORDS.output)}.`}
        </p>
      )}
    </div>
  );
}
