import { useSyncExternalStore } from "react";
import type { Profiled } from "@fossil-lang/types";

/**
 * The whole graph built from a program, once the person asks for it — *Build the graph* in the
 * assistant: made the way the studio makes one, then run under its job in this tab's worker. Before
 * that, the assistant shows a preview over a sample in the chat itself (`lib/fossil/preview.ts`),
 * run again as often as a decision changes; a build is once, and Discover only ever opens what it
 * wrote (docs/design/assistant.md, *the preview is in the chat*).
 *
 * The machine is {@link build}, over its {@link BuildSteps}; what keasy does at each step is the
 * caller's (`graphs/new/_parts/use-build.ts`). A build outlives the page that started it, as a run
 * does: the store here is module-level, so the assistant hands over to Discover and the build goes on.
 */

/** Where the build is. `graphId` is `null` until the graph is made. */
export type BuildProgress =
  | { state: "building"; graphId: string | null }
  | { state: "done"; graphId: string }
  | { state: "failed"; problem: unknown };

/** What a build does at each step; `graph` is whatever `create` answered. */
export interface BuildSteps<G extends { id: string }> {
  /** The graph, made and made this tab's to run. */
  create(program: string): Promise<G>;
  /** The whole graph, run. Resolves once it is written; rejects with why it was not. */
  full(graph: G, profiled: Profiled | undefined): Promise<void>;
}

/**
 * Build `program`: `building` while the graph is made and run, then `done` — or `failed` with what
 * stopped it, at either step. Every change is told to `onChange`; the last is the answer.
 */
export async function build<G extends { id: string }>(
  program: string,
  profiled: Profiled | undefined,
  steps: BuildSteps<G>,
  onChange: (progress: BuildProgress) => void,
): Promise<BuildProgress> {
  const set = (next: BuildProgress) => {
    onChange(next);
    return next;
  };
  set({ state: "building", graphId: null });
  try {
    const graph = await steps.create(program);
    set({ state: "building", graphId: graph.id });
    await steps.full(graph, profiled);
    return set({ state: "done", graphId: graph.id });
  } catch (problem) {
    return set({ state: "failed", problem });
  }
}

// ── The builds this tab runs ────────────────────────────────────────────────

// By the program a build was asked for, so a page mounted twice (StrictMode, or opened again)
// starts one build.
const byProgram = new Map<string, BuildProgress>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Start building `program` here, unless this tab builds it already, or has built it: a second ask is
 * the first build. One that failed may be asked again.
 */
export function startBuild<G extends { id: string }>(program: string, profiled: Profiled | undefined, steps: BuildSteps<G>): void {
  const now = byProgram.get(program);
  if (now && now.state !== "failed") return;
  void build(program, profiled, steps, (next) => {
    byProgram.set(program, next);
    for (const listener of listeners) listener();
  });
}

/** The build of `program` in this tab, or `null` before one is asked for. */
export function useProgramBuild(program: string | null): BuildProgress | null {
  return useSyncExternalStore(
    subscribe,
    () => (program === null ? null : (byProgram.get(program) ?? null)),
    () => null,
  );
}
