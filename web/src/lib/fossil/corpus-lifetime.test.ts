// @vitest-environment happy-dom
import { createElement as h, StrictMode, Suspense, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **An attached corpus lives as long as the query cache keeps its entry**, which is the cache's
 * lifecycle: kept while a page observes it, collected `gcTime` after the last one went, detached
 * when it is collected. Not as the page unmounts: Mosaic still runs what that page queued on the
 * way out, and it must find the corpus attached. The page's children suspend on their own reads of
 * the corpus, and React commits nothing of a tree that has not, so while they do no observer holds
 * the corpus query: useSuspenseQuery's floor on `gcTime` is 1 s (TanStack Query's
 * `ensureSuspenseTimers`), and a corpus collected that soon was detached under its own readers.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attached = new Set<string>();
const attaches = vi.fn((graphId: string) => void attached.add(graphId));
const detach = vi.fn(async (graphId: string) => void attached.delete(graphId));

vi.mock("@kanzo-tech/ui/analytics", () => ({
  engine: async () => ({ coordinator: {} }),
  MosaicProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/api/query-client", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const { releaseCorpora } = await import("./corpus-cache");
  const queryClient = new QueryClient();
  releaseCorpora(queryClient.getQueryCache());
  return { queryClient };
});
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
vi.mock("@fossil-lang/corpus", () => ({
  attach: async (graphId: string) => {
    attaches(graphId);
    return { detach: () => detach(graphId) };
  },
}));

const { queryClient } = await import("@/lib/api/query-client");
const { CORPUS_GC_MS, CorpusProvider, corpusKey, useCorpus } = await import("./corpus");

const GRAPH = "00000000-0000-4000-8000-000000000001";

/** A child that reads the corpus for `ms` before it can draw, and records whether it was still there; the cache keeps what it read until the corpus goes. */
function slowChild(ms: number, seen: boolean[]) {
  return function Child() {
    const { graphId } = useCorpus();
    useSuspenseQuery({
      queryKey: [...corpusKey(graphId), "child", ms],
      gcTime: Infinity,
      queryFn: () => new Promise<null>((resolve) => setTimeout(() => (seen.push(attached.has(graphId)), resolve(null)), ms)),
    });
    return null;
  };
}

/** The page as Discovery and the overview compose it: the corpus opened, then its readers under it. */
function Page({ child }: { child: () => null }) {
  return h(CorpusProvider, { graphId: GRAPH, children: h(child) });
}

async function render(child: () => null, { strict = false } = {}) {
  const root = createRoot(document.createElement("div"));
  const tree = h(QueryClientProvider, { client: queryClient }, h(Suspense, { fallback: null }, h(Page, { child })));
  await act(async () => root.render(strict ? h(StrictMode, null, tree) : tree));
  return root;
}

/** Real time passes: the query cache's timers and the children's reads are not faked. */
const settle = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(() => {
  vi.useRealTimers();
  queryClient.clear();
  attached.clear();
  attaches.mockClear();
  detach.mockClear();
});

describe("an attached corpus", () => {
  it("stays attached while its page's children suspend for longer than the cache's floor", async () => {
    const seen: boolean[] = [];
    const root = await render(slowChild(1_500, seen));
    await settle(2_500);
    expect(seen, "the corpus as the child's read found it").toEqual([true]);
    expect(detach).not.toHaveBeenCalled();
    expect(attached.has(GRAPH)).toBe(true);
    await act(async () => root.unmount());
  });

  it("stays attached when its page goes, and is detached with every read under it once the cache collects it", async () => {
    const root = await render(slowChild(10, []));
    await settle(100);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTime(CORPUS_GC_MS - 1));
    expect(detach, "a page that unmounts leaves its corpus for what it queued").not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(detach).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().findAll({ queryKey: corpusKey(GRAPH) })).toEqual([]);
  });

  it("is reused, not attached again, by a page that opens it within the cache's time", async () => {
    await act(async () => (await render(slowChild(10, []))).unmount());
    const root = await render(slowChild(10, []));
    await settle(100);
    expect(attaches).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("is detached when the cache is cleared", async () => {
    const root = await render(slowChild(10, []));
    await settle(100);
    await act(async () => root.unmount());
    queryClient.clear();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it("stays attached across a navigation from one page holding it to another", async () => {
    const root = createRoot(document.createElement("div"));
    const page = (key: string) =>
      h(QueryClientProvider, { client: queryClient }, h(Suspense, { fallback: null }, h(Page, { child: slowChild(10, []), key })));
    await act(async () => root.render(page("overview")));
    await settle(100);
    // A new key is a new page: the old one unmounts and the new one mounts in one commit.
    await act(async () => root.render(page("discover")));
    await settle(100);
    expect(detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("survives StrictMode's remount of the page", async () => {
    const root = await render(slowChild(10, []), { strict: true });
    await settle(100);
    expect(attaches).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
