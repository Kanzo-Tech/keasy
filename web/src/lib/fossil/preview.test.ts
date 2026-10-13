// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENGINE = { coordinator: {} };
vi.mock("@kanzo-tech/ui/analytics", () => ({ engine: async () => ENGINE }));
vi.mock("@/lib/fossil/host", () => ({ host: { name: "keasy" } }));
vi.mock("@/lib/errors", () => ({ toastError: vi.fn() }));
const FILES = [{ path: "fossil.json", bytes: new Uint8Array([123, 125]) }];
const runInWorker = vi.fn<(program: string, options: unknown) => Promise<{ report: object; files: typeof FILES }>>(async () => ({ report: {}, files: FILES }));
vi.mock("./run-worker", () => ({ runInWorker }));
type Attached = { name: string; detach: () => Promise<void> };
const attachInMemory = vi.fn<(name: string, files: unknown, options: unknown) => Promise<Attached>>(async (name) => ({ name, detach: vi.fn(async () => {}) }));
vi.mock("./memory-corpus", () => ({ attachInMemory }));

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { corpusKey } = await import("./corpus");
const { previewName, previewQuery, usePreview } = await import("./preview");

describe("the assistant's preview", () => {
  it("runs the program into memory in the run's worker, and attaches the files it answered", async () => {
    const client = new QueryClient();
    const profiled = { descriptors: [], undescribed: [] } as never;
    const corpus = await client.fetchQuery(previewQuery("program", profiled));
    expect(runInWorker).toHaveBeenCalledWith("program", expect.objectContaining({ host: { name: "keasy" }, into: "memory", profiled }));
    expect(attachInMemory).toHaveBeenCalledWith(previewName("program"), FILES, expect.objectContaining({ engine: ENGINE }));
    expect(corpus).toMatchObject({ name: previewName("program"), engine: ENGINE });
    expect(client.getQueryData(corpusKey(previewName("program")))).toBe(corpus);
  });

  it("is named by its program: a decision changed is a preview of its own", () => {
    expect(previewName("program")).toBe(previewName("program"));
    expect(previewName("program")).not.toBe(previewName("program changed"));
    expect(previewName("x")).toMatch(/^preview-[0-9a-f]{8}$/);
  });

  it("is idle with no program, runs, is ready, and keeps the last corpus while a changed program runs", async () => {
    const client = new QueryClient();
    const seen: ReturnType<typeof usePreview>[] = [];
    const last = () => seen.at(-1);
    function Probe({ program }: { program: string | null }) {
      seen.push(usePreview(program, null));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    const render = (program: string | null) => root.render(h(QueryClientProvider, { client }, h(Probe, { program })));
    await act(async () => render(null));
    expect(last()?.state).toBe("idle");

    await act(async () => render("first"));
    await vi.waitFor(() => expect(last()?.state).toBe("ready"));
    const first = (last() as { corpus: { name: string } }).corpus;
    expect(first.name).toBe(previewName("first"));

    let land!: () => void;
    attachInMemory.mockImplementationOnce(
      (name) => new Promise((resolve) => (land = () => resolve({ name, detach: vi.fn(async () => {}) }))),
    );
    await act(async () => render("second"));
    await vi.waitFor(() => expect(land).toBeTypeOf("function"));
    expect(last()).toMatchObject({ state: "running", corpus: first });
    await act(async () => land());
    await vi.waitFor(() => expect(last()).toMatchObject({ state: "ready", corpus: { name: previewName("second") } }));
    act(() => root.unmount());
  });

  it("fails with the run's problem, and runs again when asked", async () => {
    const client = new QueryClient();
    runInWorker.mockRejectedValueOnce(new Error("over budget"));
    const seen: ReturnType<typeof usePreview>[] = [];
    const last = () => seen.at(-1);
    function Probe() {
      seen.push(usePreview("failing", null));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(h(QueryClientProvider, { client }, h(Probe))));
    await vi.waitFor(() => expect(last()).toMatchObject({ state: "failed", problem: new Error("over budget") }));
    await act(async () => last()!.rerun());
    await vi.waitFor(() => expect(last()?.state).toBe("ready"));
    act(() => root.unmount());
  });
});
