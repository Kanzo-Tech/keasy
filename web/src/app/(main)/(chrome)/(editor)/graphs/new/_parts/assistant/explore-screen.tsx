"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Link } from "@kanzo-tech/navigation/next";
import { Alert, AlertDescription, AlertTitle, Button, Show, Spinner } from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import type { BuildProgress, DecisionItem } from "./model";
import { Assumption, DecisionChoice } from "./understood-screen";

/** "Preview over 200 rows · building the full graph · 38 %" — or where the build is instead. */
export function BuildLine({ build }: { build: BuildProgress }) {
  switch (build.state) {
    case "preparing":
      return (
        <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
          <Spinner aria-hidden />
          Preparing a preview with {build.previewRows} rows…
        </p>
      );
    case "preview":
      return (
        <Alert role="status">
          <AlertTitle>
            Preview over {build.previewRows} rows · building the full graph
            {build.percent !== null && ` · ${Math.round(build.percent)} %`}
          </AlertTitle>
          <AlertDescription>Answers may change once the whole graph is built.</AlertDescription>
        </Alert>
      );
    case "done":
      return null;
    case "failed":
      return <ProblemView error={build.problem} />;
  }
}

export interface ExploreScreenProps {
  /** `null` until there is a program to build. */
  build: BuildProgress | null;
  decisions: readonly DecisionItem[] | null;
  onChoose: (decision: string, option: string) => void;
}

/**
 * Screen 3, *Explore*: the hand-off to Discover with Ask beside it, over the preview while the whole
 * graph builds, and the assumptions taken — each one changeable here.
 */
export function ExploreScreen({ build, decisions, onChoose }: ExploreScreenProps) {
  const [changing, setChanging] = useState<string | null>(null);
  const assumed = (decisions ?? []).filter((d) => d.assumed !== null);
  const graphId = build && (build.state === "preview" || build.state === "done") ? build.graphId : null;
  return (
    <div className="flex flex-col gap-6">
      <Show
        fallback={<p className="text-muted-foreground text-sm">The graph is built once its recipe is written.</p>}
        when={build !== null}
      >
        {build && <BuildLine build={build} />}
      </Show>

      <Show when={graphId !== null}>
        <Button asChild className="self-start">
          <Link href={`/graphs/${graphId}/discover?panel=ask`}>
            <MessageCircleQuestion />
            Ask your data
          </Link>
        </Button>
      </Show>

      <Show when={assumed.length > 0}>
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">Assumptions</h2>
          <ul className="flex flex-col gap-2">
            {assumed.map((item) =>
              changing === item.decision.id ? (
                <li key={item.decision.id}>
                  <DecisionChoice
                    item={item}
                    onChoose={(option) => {
                      onChoose(item.decision.id, option);
                      setChanging(null);
                    }}
                  />
                </li>
              ) : (
                <Assumption item={item} key={item.decision.id} onChange={() => setChanging(item.decision.id)} />
              ),
            )}
          </ul>
        </section>
      </Show>
    </div>
  );
}
