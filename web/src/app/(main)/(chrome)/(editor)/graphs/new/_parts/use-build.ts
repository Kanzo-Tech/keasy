"use client";

import { useCallback } from "react";
import type { Profiled } from "@fossil-lang/types";
import { http, invalidate, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { startBuild, useProgramBuild, type BuildProgress, type BuildSteps } from "@/lib/fossil/build";
import { startRun } from "@/app/(main)/(chrome)/graphs/[id]/_parts/use-browser-graph-runner";
import { folderSlug, FOLDER_MAX } from "./folder";

/** Where the graph lands and what it is called, when the caller knows; otherwise chosen here. */
export interface BuildOutput {
  /** The sink connection's name; the workspace's first sink when absent. */
  sink?: string;
  /** The graph's name. */
  name?: string;
  /**
   * The assistant's conversation the graph is built from (`lib/assistant-conversation.ts`): what was
   * decided travels with the graph there, and Discover lists it.
   */
  conversation?: string;
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
 * submitted, then run with this tab as its runner — with the conversation it was built from, and run
 * here, in the run's worker, under the graph's lease (`startRun`), its corpus written under its job.
 */
export function keasySteps(output: BuildOutput = {}): BuildSteps<Schemas["Graph"]> {
  return {
    async create(script) {
      const name = output.name?.trim() || UNNAMED;
      const sink_connection = await sinkOf(output.sink);
      const { data: draft } = await http.POST("/v1/graphs", {
        body: {
          script,
          name,
          folder: freshFolder(name),
          sink_connection,
          ...(output.conversation ? { conversation: output.conversation } : {}),
        },
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

/**
 * The whole graph `program` builds, on request: `progress` is `null` until `build()` is called — the
 * assistant's *Build the whole graph* — then the build's. One build per program, which outlives the
 * page, so the person can go to Discover while it runs. Save the conversation first: once a graph is
 * built from it, it is that graph's record.
 */
export function useBuild(
  program: string | null,
  profiled: Profiled | null,
  { sink, name, conversation }: BuildOutput = {},
): { progress: BuildProgress | null; build: () => void } {
  const build = useCallback(() => {
    if (program !== null) startBuild(program, profiled ?? undefined, keasySteps({ sink, name, conversation }));
  }, [program, profiled, sink, name, conversation]);
  return { progress: useProgramBuild(program), build };
}
