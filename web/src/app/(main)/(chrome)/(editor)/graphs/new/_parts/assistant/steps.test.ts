import { describe, expect, it } from "vitest";

import type { DecisionItem } from "./model";
import { type StepFacts, stepsOf } from "./steps";

const open: DecisionItem = {
  decision: { id: "link", question: "One link or two?", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] },
  assumed: null,
  chosen: null,
};

const facts: StepFacts = {
  files: 6,
  reading: null,
  things: [
    { id: "awards", name: "Awards", count: 1026, holds: [] },
    { id: "laureates", name: "Laureates", count: 1012, holds: [] },
  ],
  decisions: [],
  failures: [],
  asked: false,
  program: null,
  writing: false,
  preview: "idle",
  build: null,
};

const row = (steps: ReturnType<typeof stepsOf>) => steps.map((s) => `${s.status}${s.failed ? "!" : ""}:${s.label}`);

describe("the steps of reading", () => {
  it("say what was read, with the counts, and what is still to come", () => {
    const steps = stepsOf("read", facts, 200);
    expect(row(steps)).toEqual(["complete:Read 6 files", "complete:Proposed the types", "pending:Write the program", "pending:Run the preview"]);
    expect(steps[0]!.description).toBe("1,026 awards, 1,012 laureates");
  });

  it("are pending until the files are read, then the types are being proposed", () => {
    expect(row(stepsOf("read", { ...facts, reading: { done: 0, total: 6 } }, 200)).slice(0, 2)).toEqual([
      "active:Reading 6 files…",
      "pending:Propose the types",
    ]);
    expect(row(stepsOf("read", { ...facts, decisions: null }, 200))[1]).toBe("active:Proposing the types…");
  });

  it("wait for the person, in words, while a decision has no safe answer", () => {
    expect(row(stepsOf("read", { ...facts, decisions: [open] }, 200))[2]).toBe("active:Waiting for you: 1 left to decide, with no safe answer");
    expect(row(stepsOf("read", { ...facts, decisions: [{ ...open, chosen: "one" }] }, 200))).not.toContain(expect.stringContaining("Waiting"));
  });

  it("hand the work to come to the next list once the questions are asked, and say a Task that failed", () => {
    expect(row(stepsOf("read", { ...facts, asked: true }, 200))).toEqual(["complete:Read 6 files", "complete:Proposed the types"]);
    const failure = [{ task: "model" as const, problem: new Error("x"), retry: () => {} }];
    expect(row(stepsOf("read", { ...facts, decisions: null, failures: failure }, 200))[1]).toBe("complete!:Could not propose the types");
  });
});

describe("the steps of the run", () => {
  it("write the program, then run it over the first rows of each file", () => {
    const at = (over: Partial<StepFacts>) => row(stepsOf("run", { ...facts, asked: true, ...over }, 200));
    expect(at({})).toEqual(["active:Writing the program…", "pending:Run it over the first 200 rows of each file"]);
    expect(at({ program: "p", preview: "running" })).toEqual(["complete:Wrote the program", "active:Running it over the first 200 rows of each file…"]);
    expect(at({ program: "p", preview: "ready" })).toEqual(["complete:Wrote the program", "complete:Ran it over the first 200 rows of each file"]);
    expect(at({ program: "p", preview: "failed" })[1]).toBe("complete!:Could not run it over the first 200 rows of each file");
    // A decision changed writes it again.
    expect(at({ program: "p", writing: true, preview: "ready" })[0]).toBe("active:Writing the program…");
  });

  it("offer the editor on the program once it is written", () => {
    expect(stepsOf("run", { ...facts, program: "p", preview: "ready" }, 200)[0]!.action).toBe("editor");
    expect(stepsOf("run", facts, 200)[0]!.action).toBeUndefined();
  });
});

describe("the steps of the build", () => {
  it("keep the conversation, then build from every row", () => {
    const at = (build: StepFacts["build"]) => row(stepsOf("build", { ...facts, build }, 200));
    expect(at(null)).toEqual(["active:Keeping this conversation…", "pending:Build the graph from every row"]);
    expect(at({ state: "building", graphId: "g" })).toEqual(["complete:Kept this conversation", "active:Building the graph from every row…"]);
    expect(at({ state: "done", graphId: "g" })).toEqual(["complete:Kept this conversation", "complete:Built the graph from every row"]);
    expect(at({ state: "failed", problem: new Error("x") })[1]).toBe("complete!:Could not build the graph");
  });
});
