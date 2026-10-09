// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **An attach the cache gave up on is detached when it lands.** Removing or resetting the corpus
 * entry while its attach is still out cancels the query: TanStack aborts the query function's
 * `signal` and drops whatever it resolves to later, so no `removed` event ever carries that
 * attachment. fossil's `attach` rejects on an abort only when a step fails; a statement that runs to
 * the end lands anyway. Whatever lands after the abort is detached by the query function itself.
 */

const detach = vi.fn(async () => {});
const attaches = vi.fn();
/** The attach still out, settled by the test. */
let land: () => void = () => {};

vi.mock("@kanzo-tech/ui/analytics", () => ({ engine: async () => ({ coordinator: {} }) }));
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
vi.mock("@/lib/errors", () => ({ toastError: vi.fn() }));
vi.mock("@fossil-lang/corpus", () => ({
  attach: () =>
    new Promise((resolve) => {
      attaches();
      land = () => resolve({ name: "corpus", detach, [Symbol.asyncDispose]: detach });
    }),
}));

const { CancelledError, QueryClient } = await import("@tanstack/react-query");
const { releaseCorpora } = await import("./corpus-cache");
const { corpusKey, corpusQuery } = await import("./corpus");

const GRAPH = "00000000-0000-4000-8000-000000000001";

function cache() {
  const queryClient = new QueryClient();
  releaseCorpora(queryClient.getQueryCache());
  return queryClient;
}

/** The attach out, as a page that opens the corpus starts it; what opening it answers, once it does. */
async function attaching(queryClient: InstanceType<typeof QueryClient>) {
  const opened = queryClient.fetchQuery(corpusQuery(GRAPH));
  await vi.waitFor(() => expect(attaches).toHaveBeenCalledTimes(1));
  return { opened };
}

afterEach(() => {
  attaches.mockClear();
  detach.mockClear();
});

describe("an attach in flight", () => {
  it("is detached when it lands after the cache removed its entry", async () => {
    const queryClient = cache();
    const { opened } = await attaching(queryClient);
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    await expect(opened).rejects.toBeInstanceOf(CancelledError);
    expect(detach).not.toHaveBeenCalled();
    land();
    await vi.waitFor(() => expect(detach).toHaveBeenCalledTimes(1));
  });

  it("is detached when it lands after the cache was reset, as switching workspace does", async () => {
    const queryClient = cache();
    const { opened } = await attaching(queryClient);
    await queryClient.resetQueries();
    await expect(opened).rejects.toBeInstanceOf(CancelledError);
    land();
    await vi.waitFor(() => expect(detach).toHaveBeenCalledTimes(1));
  });

  it("is kept when it lands with its entry still there, until the cache removes it", async () => {
    const queryClient = cache();
    const { opened } = await attaching(queryClient);
    land();
    await expect(opened).resolves.toMatchObject({ graphId: GRAPH });
    expect(detach).not.toHaveBeenCalled();
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
