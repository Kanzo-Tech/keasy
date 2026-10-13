// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { FossilError, isFossilError } from "@fossil-lang/types";
import { describe, expect, it, vi } from "vitest";

import { build, previewOf, PREVIEW_ROWS, startBuild, useGraphBuild, type Build, type BuildSteps, type Preview } from "./build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW: Preview = { attach: vi.fn() };

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

/** Steps over a mocked executor: the graph `g1`, a preview, and a full run the test ends. */
function steps(overrides: Partial<BuildSteps<{ id: string }>> = {}) {
  const full = deferred();
  const order: string[] = [];
  const s: BuildSteps<{ id: string }> = {
    create: vi.fn(async () => {
      order.push("create");
      return { id: "g1" };
    }),
    preview: vi.fn(async () => {
      order.push("preview");
      return PREVIEW;
    }),
    full: vi.fn(async (_graph, _profiled, onPercent) => {
      order.push("full");
      onPercent(40);
      await full.promise;
    }),
    ...overrides,
  };
  return { steps: s, full, order };
}

const states = (seen: Build[]) => seen.map((b) => b.progress.state);

describe("a build", () => {
  it("makes the graph, runs the preview over a sample, then the whole graph", async () => {
    const { steps: s, full, order } = steps();
    const seen: Build[] = [];
    const done = build("program", undefined, s, (b) => seen.push(b));
    await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    expect(order).toEqual(["create", "preview", "full"]);
    expect(seen[0]).toEqual({ progress: { state: "preparing", previewRows: PREVIEW_ROWS }, preview: null });
    expect(seen.at(-1)).toEqual({
      progress: { state: "preview", previewRows: PREVIEW_ROWS, graphId: "g1", percent: 40 },
      preview: PREVIEW,
    });
    full.resolve();
    expect(await done).toEqual({ progress: { state: "done", graphId: "g1" }, preview: null });
    expect(states(seen)).toEqual(["preparing", "preview", "preview", "done"]);
  });

  it("goes straight to the whole graph where nothing takes a sample", async () => {
    const { steps: s, full } = steps({ preview: undefined });
    const seen: Build[] = [];
    full.resolve();
    await build("program", undefined, s, (b) => seen.push(b));
    expect(seen[0]?.progress).toEqual({ state: "preparing", previewRows: null });
    expect(states(seen)).toEqual(["preparing", "done"]);
  });

  it("fails with the preview's problem, and never runs the whole graph", async () => {
    const problem = FossilError.of("document/unread", { documents: ["@lake/people.shex"] });
    const { steps: s } = steps({ preview: vi.fn(async () => Promise.reject(problem)) });
    const ended = await build("program", undefined, s, () => {});
    expect(ended.progress.state).toBe("failed");
    expect(isFossilError((ended.progress as { problem: unknown }).problem, "document/unread")).toBe(true);
    expect(s.full).not.toHaveBeenCalled();
  });

  it("fails with the whole graph's problem after its preview, and lets the preview go", async () => {
    const { steps: s, full } = steps();
    const seen: Build[] = [];
    const ended = build("program", undefined, s, (b) => seen.push(b));
    await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    full.reject(new Error("over budget"));
    expect(await ended).toEqual({ progress: { state: "failed", problem: new Error("over budget") }, preview: null });
  });

  it("fails when the graph cannot be made", async () => {
    const { steps: s } = steps({ create: vi.fn(async () => Promise.reject(new Error("no sink"))) });
    expect((await build("program", undefined, s, () => {})).progress).toEqual({ state: "failed", problem: new Error("no sink") });
    expect(s.preview).not.toHaveBeenCalled();
  });
});

describe("what Discover opens", () => {
  it("is the preview while it is what there is, then the whole graph", async () => {
    const { steps: s, full } = steps();
    const opened: (Preview | undefined)[] = [];
    function Probe() {
      opened.push(previewOf(useGraphBuild("g1")));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(h(Probe)));
    expect(opened.at(-1)).toBeUndefined();

    await act(async () => {
      startBuild("the preview program", undefined, s);
      await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    });
    expect(opened.at(-1)).toBe(PREVIEW);

    await act(async () => full.resolve());
    expect(opened.at(-1)).toBeUndefined();
    act(() => root.unmount());
  });

  it("starts one build however often it is asked", async () => {
    const { steps: s, full } = steps();
    startBuild("one program", undefined, s);
    startBuild("one program", undefined, s);
    full.resolve();
    await vi.waitFor(() => expect(s.full).toHaveBeenCalled());
    expect(s.create).toHaveBeenCalledTimes(1);
  });
});
