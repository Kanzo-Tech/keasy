/**
 * What the assistant is doing now, as one line — *Reading 6 files*, *Writing the program* — or `null`
 * when nothing runs (docs/design/assistant.md, *One line while it works*). Derived each time from
 * what the conversation already knows and never kept; what the work found is the panel's.
 */

import type { BuildProgress, DecisionItem, ReadingProgress, TaskFailure, Thing } from "./model";

/** The preview run, as far as the line needs to tell it. */
export type RunState = "idle" | "running" | "ready" | "failed";

/** What the line reads: all of it already answered by the hook and the conversation. */
export interface WorkingFacts {
  /** The files picked. */
  files: number;
  reading: ReadingProgress | null;
  things: readonly Thing[];
  decisions: readonly DecisionItem[] | null;
  failures: readonly TaskFailure[];
  /** The program the mapping wrote, `null` until it has. */
  program: string | null;
  /** The mapping is writing it again. */
  writing: boolean;
  preview: RunState;
  build: BuildProgress | null;
}

const failed = (f: WorkingFacts, task: TaskFailure["task"]) => f.failures.some((x) => x.task === task);

/** The work under way, in the order it happens; a Task that failed is said where it stopped instead. */
export function workingOf(f: WorkingFacts): string | null {
  if (f.reading !== null) return f.files === 1 ? "Reading the file" : `Reading ${f.files} files`;
  if (f.build?.state === "building") return "Building the graph from every row";
  if (f.things.length === 0) return null;
  if (f.decisions === null) return "Naming the kinds of thing";
  if (failed(f, "mapping")) return null;
  if (f.program === null || f.writing) return "Writing the program";
  if (f.preview === "running") return "Running the preview";
  return null;
}
