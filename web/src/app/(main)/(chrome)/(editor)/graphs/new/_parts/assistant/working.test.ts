import { describe, expect, it } from "vitest";
import { type WorkingFacts, workingOf } from "./working";

const read: WorkingFacts = {
  files: 6,
  reading: null,
  things: [{ id: "laureates", name: "Laureates", count: 1018, holds: [] }],
  decisions: [],
  failures: [],
  program: "program",
  writing: false,
  preview: "ready",
  build: null,
};

describe("the line while the assistant works", () => {
  it("says the work under way, in the order it happens", () => {
    expect(workingOf({ ...read, reading: { done: 2, total: 6 } })).toBe("Reading 6 files");
    expect(workingOf({ ...read, files: 1, reading: { done: 0, total: 1 } })).toBe("Reading the file");
    expect(workingOf({ ...read, decisions: null })).toBe("Naming the kinds of thing");
    expect(workingOf({ ...read, program: null })).toBe("Writing the program");
    expect(workingOf({ ...read, writing: true })).toBe("Writing the program");
    expect(workingOf({ ...read, preview: "running" })).toBe("Running the preview");
    expect(workingOf({ ...read, build: { state: "building", graphId: "g" } })).toBe("Building the graph from every row");
  });

  it("is gone when nothing runs, and where a Task stopped: its problem is said there", () => {
    expect(workingOf(read)).toBeNull();
    expect(workingOf({ ...read, program: null, failures: [{ task: "mapping", problem: null, retry: () => {} }] })).toBeNull();
  });
});
