import { useSyncExternalStore } from "react";
import type { Attachment } from "@fossil-lang/corpus";
import type { Profiled } from "@fossil-lang/types";
import type { Engine } from "@kanzo-tech/ui/analytics";

/**
 * A graph built from a program, as the assistant's last turn and Discover read it: made the way the
 * studio makes one, then run twice — a preview over the first {@link PREVIEW_ROWS} rows of each
 * source, which Discover opens on, and the whole graph in the background, which Discover switches to
 * when it lands (docs/design/assistant.md, *time to smile*).
 *
 * The machine is {@link build}, over its {@link BuildSteps}; what keasy does at each step is the
 * caller's (`graphs/new/_parts/use-build.ts`). A build outlives the page that started it, as a run
 * does: the store here is module-level, so the assistant hands over to Discover and Discover still
 * finds it.
 */

/** The rows of each source the preview reads. */
export const PREVIEW_ROWS = 200;

/** Where the graph is: a preview first, over a few rows, then the whole of it. */
export type BuildProgress =
  /** `previewRows` is `null` when there will be no preview: the whole graph is what is prepared. */
  | { state: "preparing"; previewRows: number | null }
  | { state: "preview"; previewRows: number; graphId: string; percent: number | null }
  | { state: "done"; graphId: string }
  | { state: "failed"; problem: unknown };

/** A preview's corpus, as Discover attaches it: under `name`, on the page's engine. */
export interface Preview {
  attach(name: string, options: { engine: Engine; signal: AbortSignal }): Promise<Attachment>;
}

/** What a build does at each step; `graph` is whatever `create` answered. */
export interface BuildSteps<G extends { id: string }> {
  /** The graph, made and made this tab's to run. */
  create(program: string): Promise<G>;
  /**
   * The program over the first {@link PREVIEW_ROWS} rows of each source, and where its corpus is.
   * Absent where nothing can take a sample: the build then goes straight to the whole graph.
   */
  preview?: (graph: G, profiled: Profiled | undefined) => Promise<Preview>;
  /** The whole graph. Resolves once it is written; rejects with why it was not. */
  full(graph: G, profiled: Profiled | undefined, onPercent: (percent: number | null) => void): Promise<void>;
}

/** A build as it stands: its progress, and the preview's corpus while the preview is what there is. */
export interface Build {
  progress: BuildProgress;
  preview: Preview | null;
}

/**
 * Build `program`: `preparing` while the graph is made and its preview runs, `preview` once the
 * preview's corpus is there and while the whole graph builds, then `done` — or `failed` with what
 * stopped it, at any step. A preview that fails fails the build: the whole graph would read the same
 * sources with the same program. Every change is told to `onChange`; the last is the answer.
 */
export async function build<G extends { id: string }>(
  program: string,
  profiled: Profiled | undefined,
  steps: BuildSteps<G>,
  onChange: (build: Build) => void,
): Promise<Build> {
  let current: Build = { progress: { state: "preparing", previewRows: steps.preview ? PREVIEW_ROWS : null }, preview: null };
  const set = (next: Build) => {
    current = next;
    onChange(next);
    return next;
  };
  set(current);
  try {
    const graph = await steps.create(program);
    if (steps.preview) {
      const preview = await steps.preview(graph, profiled);
      set({ progress: { state: "preview", previewRows: PREVIEW_ROWS, graphId: graph.id, percent: null }, preview });
    }
    await steps.full(graph, profiled, (percent) => {
      if (current.progress.state === "preview") set({ ...current, progress: { ...current.progress, percent } });
    });
    return set({ progress: { state: "done", graphId: graph.id }, preview: null });
  } catch (problem) {
    return set({ progress: { state: "failed", problem }, preview: null });
  }
}

// ── The builds this tab runs ────────────────────────────────────────────────

// By what started them, so a page mounted twice (StrictMode, or opened again) starts one build: the
// program a build was asked for, and the graph it made, once it has one.
const byProgram = new Map<string, Build>();
const byGraph = new Map<string, Build>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const graphOf = (progress: BuildProgress) => ("graphId" in progress ? progress.graphId : undefined);

/**
 * Start building `program` here, unless this tab builds it already: a second ask is the first build.
 * The key is the program as it will be written, so a program changed — an assumption changed — is a
 * build of its own.
 */
export function startBuild<G extends { id: string }>(program: string, profiled: Profiled | undefined, steps: BuildSteps<G>): void {
  if (byProgram.has(program)) return;
  void build(program, profiled, steps, (next) => {
    byProgram.set(program, next);
    const graphId = graphOf(next.progress);
    if (graphId) byGraph.set(graphId, next);
    for (const listener of listeners) listener();
  });
}

/** The build of `program` in this tab, or `null` before one is started. */
export function useProgramBuild(program: string | null): Build | null {
  return useSyncExternalStore(
    subscribe,
    () => (program === null ? null : (byProgram.get(program) ?? null)),
    () => null,
  );
}

/** The build of graph `graphId` in this tab, if this tab builds it: what Discover opens on. */
export function useGraphBuild(graphId: string): Build | undefined {
  return useSyncExternalStore(
    subscribe,
    () => byGraph.get(graphId),
    () => undefined,
  );
}

/** The preview to open a graph on: the build's, while the preview is what there is. */
export function previewOf(build: Build | undefined): Preview | undefined {
  return build?.progress.state === "preview" ? (build.preview ?? undefined) : undefined;
}
