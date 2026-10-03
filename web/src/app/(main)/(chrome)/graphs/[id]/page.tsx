"use client";

import { use } from "react";
import {
  Clipboard,
  ClipboardControl,
  ClipboardInput,
  ClipboardTrigger,
  DataList,
  DataListItem,
  DataListItemLabel,
  DataListItemValue,
  SectionBody,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
} from "@kanzo-tech/ui";
import { useSession } from "@kanzo-tech/auth";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatGraphDuration } from "@/lib/ui/format";
import { runProblem } from "@/lib/graphs";
import { lower, WORDS } from "@/lib/vocabulary";
import { ProblemView } from "@/components/problem-view";
import { Provenance } from "@/components/provenance";
import { Boundary, Loading } from "@/components/boundary";
import { CorpusHolds } from "@/components/corpus-holds";
import { runnerName } from "./_parts/graph-header";
import { useGraph } from "./_parts/use-graph";

/** The graph's overview: its last run, where its output lands, and what that output holds. */
export default function GraphOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const graph = useGraph(id);
  const problem = runProblem(graph);
  return (
    <div className="flex flex-col gap-8">
      <Provenance of={graph} />
      {problem && <ProblemView error={problem} />}
      <LastRun graph={graph} />
      <Part title={`${WORDS.output} location`}>
        {graph.output ? (
          <Clipboard className="max-w-2xl" value={graph.output}>
            <ClipboardControl>
              <ClipboardInput className="font-mono text-xs" />
              <ClipboardTrigger aria-label={`Copy the ${lower(WORDS.output)} location`} />
            </ClipboardControl>
          </Clipboard>
        ) : (
          <p className="text-muted-foreground text-sm">
            A draft has no folder yet: it gets one in {lower(WORDS.storage)} when it is created.
          </p>
        )}
      </Part>
      <Part title="Holds">
        {graph.status === "completed" ? (
          <Boundary
            fallback={
              <Loading>
                <Skeleton className="h-24 w-full" />
              </Loading>
            }
          >
            <CorpusHolds graphId={graph.id} />
          </Boundary>
        ) : (
          <p className="text-muted-foreground text-sm">
            Nothing yet: what the {lower(WORDS.output)} holds shows once a {lower(WORDS.run)} completes.
          </p>
        )}
      </Part>
    </div>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SectionRoot className="gap-3" fill={false}>
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>{title}</SectionTitle>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody>{children}</SectionBody>
    </SectionRoot>
  );
}

/** The fossil run report's `dropped`, when it carries one: what the run left out. */
function dropped(graph: Schemas["Graph"]): number | undefined {
  const value = (graph.report as { dropped?: unknown } | undefined)?.dropped;
  return Array.isArray(value) ? value.length : undefined;
}

function LastRun({ graph }: { graph: Schemas["Graph"] }) {
  const me = useSession().session?.user.id;
  const left = dropped(graph);
  return (
    <Part title={`Last ${lower(WORDS.run)}`}>
      {graph.started_at ? (
        <DataList className="grid gap-x-12 sm:grid-cols-2 lg:grid-cols-4" orientation="vertical">
          <DataListItem>
            <DataListItemLabel>Run by</DataListItemLabel>
            <DataListItemValue>{graph.runner ? runnerName(graph.runner, me) : "Unknown"}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Started</DataListItemLabel>
            <DataListItemValue>{formatDate(graph.started_at)}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Ended</DataListItemLabel>
            <DataListItemValue>{graph.completed_at ? formatDate(graph.completed_at) : "Still running"}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Duration</DataListItemLabel>
            <DataListItemValue>{formatGraphDuration(graph) || "—"}</DataListItemValue>
          </DataListItem>
          {left !== undefined && (
            <DataListItem>
              <DataListItemLabel>Dropped</DataListItemLabel>
              <DataListItemValue>{left.toLocaleString()}</DataListItemValue>
            </DataListItem>
          )}
        </DataList>
      ) : (
        <p className="text-muted-foreground text-sm">
          {graph.status === "draft"
            ? `A draft is not run: edit its ${lower(WORDS.recipe)}, then create it.`
            : `Never run. ${WORDS.run} it to write its ${lower(WORDS.output)}.`}
        </p>
      )}
    </Part>
  );
}
