// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { FossilError, isFossilError } from "@fossil-lang/types";
import { describe, expect, it, vi } from "vitest";

import { build, startBuild, useProgramBuild, type BuildProgress, type BuildSteps } from "./build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A promise and its two ends, to hold a step where a test wants it. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Steps over a mocked executor: the graph `g1`, and a full run the test ends. */
function steps(overrides: Partial<BuildSteps<{ id: string }>> = {}) {
  const full = deferred();
  const s: BuildSteps<{ id: string }> = {
    create: vi.fn(async () => ({ id: "g1" })),
    full: vi.fn(async (_graph, _profiled, onPercent) => {
      onPercent(40);
      await full.promise;
    }),
    ...overrides,
  };
  return { steps: s, full };
}

describe("a build", () => {
  it("makes the graph, then runs the whole of it", async () => {
    const { steps: s, full } = steps();
    const seen: BuildProgress[] = [];
    const done = build("program", undefined, s, (b) => seen.push(b));
    await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    full.resolve();
    expect(await done).toEqual({ state: "done", graphId: "g1" });
    expect(seen).toEqual([
      { state: "building", graphId: null, percent: null },
      { state: "building", graphId: "g1", percent: null },
      { state: "building", graphId: "g1", percent: 40 },
      { state: "done", graphId: "g1" },
    ]);
  });

  it("fails with the run's problem", async () => {
    const problem = FossilError.of("document/unread", { documents: ["@lake/people.shex"] });
    const { steps: s, full } = steps();
    const ended = build("program", undefined, s, () => {});
    await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    full.reject(problem);
    const progress = await ended;
    expect(progress.state).toBe("failed");
    expect(isFossilError((progress as { problem: unknown }).problem, "document/unread")).toBe(true);
  });

  it("fails when the graph cannot be made, and runs nothing", async () => {
    const { steps: s } = steps({ create: vi.fn(async () => Promise.reject(new Error("no sink"))) });
    expect(await build("program", undefined, s, () => {})).toEqual({ state: "failed", problem: new Error("no sink") });
    expect(s.full).not.toHaveBeenCalled();
  });
});

describe("the builds of this tab", () => {
  it("are read by program, and start once however often asked", async () => {
    const { steps: s, full } = steps();
    const seen: (BuildProgress | null)[] = [];
    function Probe() {
      seen.push(useProgramBuild("one program"));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(h(Probe)));
    expect(seen.at(-1)).toBeNull();

    await act(async () => {
      startBuild("one program", undefined, s);
      startBuild("one program", undefined, s);
      await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    });
    expect(seen.at(-1)).toEqual({ state: "building", graphId: "g1", percent: 40 });
    await act(async () => full.resolve());
    expect(seen.at(-1)).toEqual({ state: "done", graphId: "g1" });
    startBuild("one program", undefined, s);
    expect(s.create).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("start again after one failed", async () => {
    const create = vi.fn(async () => Promise.reject(new Error("no sink")));
    const { steps: s } = steps({ create });
    startBuild("a failing program", undefined, s);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      startBuild("a failing program", undefined, s);
      expect(create).toHaveBeenCalledTimes(2);
    });
  });
});
