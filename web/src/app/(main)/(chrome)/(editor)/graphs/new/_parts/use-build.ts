"use client";

import { useEffect, useMemo } from "react";
import type { Profiled } from "@fossil-lang/types";
import type { Decision } from "@kanzo-tech/ai/task";
import { http, invalidate, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { taken, withDecisions } from "@/lib/assumptions";
import { startBuild, useProgramBuild, type BuildProgress, type BuildSteps } from "@/lib/fossil/build";
import { startRun } from "@/app/(main)/(chrome)/graphs/[id]/_parts/use-browser-graph-runner";
import { folderSlug, FOLDER_MAX } from "./folder";

/** Where the graph lands and what it is called, when the caller knows; otherwise chosen here. */
export interface BuildOutput {
  /** The sink connection's name; the workspace's first sink when absent. */
  sink?: string;
  /** The graph's name. */
  name?: string;
}

const UNNAMED = "New graph";

/** A folder for `name` no other graph has: its slug and a few random characters. */
export function freshFolder(name: string, random: () => number = Math.random): string {
  const tail = random().toString(36).slice(2, 8).padEnd(6, "0");
  return `${folderSlug(name).slice(0, FOLDER_MAX - tail.length - 1).replace(/-+$/, "")}-${tail}`;
}

/** The sink the graph lands in: the one named, else the workspace's first. */
async function sinkOf(named: string | undefined): Promise<string> {
  if (named) return named;
  const connections = await queryClient.fetchQuery({
    queryKey: ["get", "/v1/connections", {}],
    queryFn: async ({ signal }) => (await http.GET("/v1/connections", { signal })).data ?? [],
  });
  const sink = connections.find((c) => c.target.direction === "sink");
  if (!sink) throw new Error("There is no sink connection to build the graph into. Add one under Connections.");
  return sink.name;
}

/**
 * keasy's steps of a build (`lib/fossil/build.ts`): the graph made as the studio makes one — a draft,
 * submitted, then run with this tab as its runner — and run here, in the run's worker, under the
 * graph's lease (`startRun`).
 *
 * **No preview yet.** fossil's `run` reads every row of every source — it has no row limit — and a
 * running graph's output is the runner's to write and nobody's to read until it completes
 * (`graph/not-completed`), so a sample written under the graph's prefix could be neither taken nor
 * opened. The build goes from `preparing` to the whole graph until one of them gives way; the
 * machine, Discover's switch and the hand-off already take a {@link BuildSteps.preview}.
 */
export function keasySteps(output: BuildOutput = {}): BuildSteps<Schemas["Graph"]> {
  return {
    async create(script) {
      const name = output.name?.trim() || UNNAMED;
      const sink_connection = await sinkOf(output.sink);
      const { data: draft } = await http.POST("/v1/graphs", {
        body: { script, name, folder: freshFolder(name), sink_connection },
      });
      const id = draft!.id;
      await http.POST("/v1/graphs/{id}/submit", { params: { path: { id } }, body: {} });
      const { data: running } = await http.POST("/v1/graphs/{id}/run", { params: { path: { id } } });
      await invalidate("/v1/graphs");
      return running!;
    },
    async full(graph, profiled) {
      const ended = await startRun(graph, { profiled });
      if (ended.status === "failed") throw ended.problem;
      if (ended.status === "cancelled") throw new DOMException("The build was stopped", "AbortError");
    },
  };
}

/** A decision as the assistant holds it: the default it assumed, and the person's pick over it. */
interface HeldDecision {
  decision: Decision;
  assumed: string | null;
  chosen: string | null;
}

/**
 * The graph `program` builds, as the assistant's last turn reads it: `null` until there is a program,
 * then the build's progress. The build starts once per program — `decisions` written at its head,
 * so a decision changed is a build of its own — and outlives the page, so Discover finds it.
 */
export function useBuild(
  program: string | null,
  profiled: Profiled | null,
  { decisions = [], ...output }: BuildOutput & { decisions?: readonly HeldDecision[] } = {},
): BuildProgress | null {
  const script = useMemo(() => (program === null ? null : withDecisions(program, taken(decisions))), [program, decisions]);
  const { sink, name } = output;
  useEffect(() => {
    if (script !== null) startBuild(script, profiled ?? undefined, keasySteps({ sink, name }));
  }, [script, profiled, sink, name]);
  return useProgramBuild(script)?.progress ?? null;
}
