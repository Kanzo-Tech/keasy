/**
 * The steps the assistant says it is taking — *What I am doing* — as data: each of the three lists
 * the thread draws (`Turn`'s `steps`), derived from state the conversation already knows (the
 * reading, the `model` Task, the decisions, the program, the preview, the build), never kept. Nothing
 * is drawn here (`chain-of-thought.tsx` draws a step), and a step the work has not reached is
 * `pending`, so the person reads what is still to come as well as what is done.
 */

import type { StepsGroup } from "./conversation";
import { type BuildProgress, type DecisionItem, optionOf, type ReadingProgress, type TaskFailure, type Thing } from "./model";
import { inWords } from "./tasks/words";

/** The rows of the preview run, as far as a step needs to tell them. */
export type RunState = "idle" | "running" | "ready" | "failed";

export interface Step {
  id: string;
  /** AI Elements' `ChainOfThoughtStep` statuses: done, under way (or waiting), or still to come. */
  status: "complete" | "active" | "pending";
  label: string;
  /** What it took or gave: *1,026 awards, 1,012 laureates*. */
  description?: string;
  /** The step stopped: its problem is said where it happened. */
  failed?: boolean;
  /** An action on the step. */
  action?: "editor";
}

/** What the steps read: all of it already answered by the hook and the conversation. */
export interface StepFacts {
  /** The files picked. */
  files: number;
  reading: ReadingProgress | null;
  things: readonly Thing[];
  decisions: readonly DecisionItem[] | null;
  failures: readonly TaskFailure[];
  /** The person has asked all they wanted. */
  asked: boolean;
  /** The program the mapping wrote, `null` until it has. */
  program: string | null;
  /** The mapping is writing it again. */
  writing: boolean;
  preview: RunState;
  build: BuildProgress | null;
}

const count = new Intl.NumberFormat("en-GB");
const files = (n: number) => (n === 1 ? "the file" : `${n} files`);
const failed = (f: StepFacts, task: TaskFailure["task"]) => f.failures.some((x) => x.task === task);

/** *Read 6 files · 1,026 awards, 1,012 laureates*, *Proposed the types*, and what comes after them. */
function readSteps(f: StepFacts): Step[] {
  const reading = f.reading !== null;
  const counted = f.things.flatMap((t) => (t.count === null ? [] : [`${count.format(t.count)} ${t.name.toLowerCase()}`]));
  const open = (f.decisions ?? []).filter((d) => optionOf(d) === null).length;
  const steps: Step[] = [
    reading
      ? { id: "read", status: "active", label: `Reading ${files(f.files)}…` }
      : { id: "read", status: "complete", label: `Read ${files(f.files)}`, description: counted.length > 0 ? counted.join(", ") : undefined },
    reading || f.things.length === 0
      ? { id: "model", status: "pending", label: "Propose the types" }
      : failed(f, "model")
        ? { id: "model", status: "complete", failed: true, label: "Could not propose the types" }
        : f.decisions === null
          ? { id: "model", status: "active", label: "Proposing the types…" }
          : { id: "model", status: "complete", label: "Proposed the types" },
  ];
  if (open > 0) {
    steps.push({
      id: "decide",
      status: "active",
      label: `Waiting for you: ${open === 1 ? "one decision has" : `${inWords(open, "decision")} have`} no safe answer`,
    });
  }
  // The work to come is on the list from the start; once the questions are asked it moves to its own.
  if (!f.asked) {
    steps.push({ id: "program", status: "pending", label: "Write the program" }, { id: "preview", status: "pending", label: "Run the preview" });
  }
  return steps;
}

/** *Wrote the program · Open in the editor*, *Ran it over the first 200 rows of each file*. */
function runSteps(f: StepFacts, rows: number): Step[] {
  const run = `it over the first ${rows} rows of each file`;
  return [
    failed(f, "mapping")
      ? { id: "program", status: "complete", failed: true, label: "Could not write the program" }
      : f.program === null || f.writing
        ? { id: "program", status: "active", label: "Writing the program…" }
        : { id: "program", status: "complete", label: "Wrote the program", action: "editor" },
    f.program === null || f.writing
      ? { id: "preview", status: "pending", label: `Run ${run}` }
      : f.preview === "failed"
        ? { id: "preview", status: "complete", failed: true, label: `Could not run ${run}` }
        : f.preview === "ready"
          ? { id: "preview", status: "complete", label: `Ran ${run}` }
          : { id: "preview", status: "active", label: `Running ${run}…` },
  ];
}

/** *Kept this conversation*, *Built the graph from every row*. */
function buildSteps(f: StepFacts): Step[] {
  const build = f.build;
  return [
    build === null
      ? { id: "kept", status: "active", label: "Keeping this conversation…" }
      : { id: "kept", status: "complete", label: "Kept this conversation" },
    build === null
      ? { id: "built", status: "pending", label: "Build the graph from every row" }
      : build.state === "building"
        ? { id: "built", status: "active", label: "Building the graph from every row…" }
        : build.state === "failed"
          ? { id: "built", status: "complete", failed: true, label: "Could not build the graph" }
          : { id: "built", status: "complete", label: "Built the graph from every row" },
  ];
}

/** The steps of `group`; `rows` is how many rows of each file the preview reads. */
export function stepsOf(group: StepsGroup, facts: StepFacts, rows: number): Step[] {
  switch (group) {
    case "read":
      return readSteps(facts);
    case "run":
      return runSteps(facts, rows);
    case "build":
      return buildSteps(facts);
  }
}
