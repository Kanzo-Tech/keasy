// @vitest-environment happy-dom
import { createElement as h, StrictMode, Suspense, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **An attached corpus lives as long as a committed page holds it**, not as long as the query
 * cache keeps its entry. The page's children suspend on their own reads of the corpus — the join
 * graph, the graph's tables, the dashboard's stats — and React keeps nothing of a tree that has not
 * committed, so while they do, no observer holds the corpus query. useSuspenseQuery's floor on
 * `gcTime` is 1 s (TanStack Query's `ensureSuspenseTimers`): a corpus whose children take longer
 * than that to read, as the 327.6K vertices of LDBC SNB do on a CI runner, would be collected and
 * detached under them, and every read in flight fails with `schema "<graph>" does not exist`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const attached = new Set<string>();
const detach = vi.fn(async (graphId: string) => void attached.delete(graphId));

vi.mock("@kanzo-tech/ui/analytics", () => ({
  engine: async () => ({ coordinator: {} }),
  MosaicProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/api/query-client", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return { queryClient: new QueryClient() };
});
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
vi.mock("@fossil-lang/corpus", () => ({
  attach: async (graphId: string) => {
    attached.add(graphId);
    return { detach: () => detach(graphId) };
  },
}));

const { queryClient } = await import("@/lib/api/query-client");
const { CorpusProvider, corpusQuery, useCorpus } = await import("./corpus");

const GRAPH = "00000000-0000-4000-8000-000000000001";

/** A child that reads the corpus for `ms` before it can draw, and records whether it was still there. */
function slowChild(ms: number, seen: boolean[]) {
  return function Child() {
    const { graphId } = useCorpus();
    useSuspenseQuery({
      queryKey: ["child", graphId, ms],
      queryFn: () => new Promise<null>((resolve) => setTimeout(() => (seen.push(attached.has(graphId)), resolve(null)), ms)),
    });
    return null;
  };
}

/** The page as Discovery and the overview compose it: the corpus opened, then its readers under it. */
function Page({ child }: { child: () => null }) {
  const corpus = useSuspenseQuery(corpusQuery(GRAPH)).data;
  return h(CorpusProvider, { value: corpus, children: h(child) });
}

async function render(child: () => null, { strict = false } = {}) {
  const root = createRoot(document.createElement("div"));
  const tree = h(QueryClientProvider, { client: queryClient }, h(Suspense, { fallback: null }, h(Page, { child })));
  await act(async () => root.render(strict ? h(StrictMode, null, tree) : tree));
  return root;
}

/** Real time passes: the query cache's timers and the children's reads are not faked. */
const settle = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

afterEach(async () => {
  // A test's last release lands after its unmount: let it, so the next test starts from nothing.
  await settle(50);
  queryClient.clear();
  attached.clear();
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

  it("is detached once the page that holds it has gone, and only then", async () => {
    const root = await render(slowChild(10, []));
    await settle(100);
    expect(detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    await settle(50);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(corpusQuery(GRAPH).queryKey)).toBeUndefined();
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
    expect(detach).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    await settle(50);
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
