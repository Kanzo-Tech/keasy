// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * **Every attachment the corpus entry held is detached once, when the entry lets it go** — removed,
 * reset to no data, or given a new one — and never while a reader still needs it. An attach the
 * cache gave up on while it was out is never the entry's at all: TanStack aborts the query
 * function's `signal` and drops whatever it resolves to later, and fossil's `attach` rejects on an
 * abort only when a step fails, so the query function detaches what lands after the abort itself.
 */

/** One attach: settled by the test, and the attachment it lands with. */
interface Out {
  land(): void;
  detach: ReturnType<typeof vi.fn>;
}
const out: Out[] = [];

vi.mock("@kanzo-tech/ui/analytics", () => ({ engine: async () => ({ coordinator: {} }) }));
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
const toastError = vi.fn();
vi.mock("@/lib/errors", () => ({ toastError }));
vi.mock("@fossil-lang/corpus", () => ({
  attach: () =>
    new Promise((resolve) => {
      const detach = vi.fn(async () => {});
      out.push({ land: () => resolve({ name: "corpus", detach, [Symbol.asyncDispose]: detach }), detach });
    }),
}));

const { CancelledError, QueryClient, QueryObserver } = await import("@tanstack/react-query");
const { RELEASE_FAILED, releaseCorpora } = await import("./corpus-cache");
const { corpusKey, corpusQuery } = await import("./corpus");

const GRAPH = "00000000-0000-4000-8000-000000000001";
type Client = InstanceType<typeof QueryClient>;

/** What failed to detach, as the app's failure path would hear it. */
const onFailure = vi.fn();

function cache() {
  const queryClient = new QueryClient();
  releaseCorpora(queryClient.getQueryCache(), { onFailure });
  return queryClient;
}

/** The `n`th attach, once the query function has started it. */
async function attachOut(n: number): Promise<Out> {
  await vi.waitFor(() => expect(out.length).toBeGreaterThanOrEqual(n));
  return out[n - 1]!;
}

/** The attach out, as a page that opens the corpus starts it; what opening it answers, once it does. */
async function attaching(queryClient: Client) {
  const opened = queryClient.fetchQuery(corpusQuery(GRAPH));
  return { opened, first: await attachOut(1) };
}

/** The corpus attached, its entry in the cache and nothing reading it. */
async function attached(queryClient: Client) {
  const { opened, first } = await attaching(queryClient);
  first.land();
  await opened;
  return first;
}

/** A reader holding the entry, as a page on screen does. */
function reader(queryClient: Client) {
  return new QueryObserver(queryClient, corpusQuery(GRAPH)).subscribe(() => {});
}

afterEach(() => {
  // A failure no test asked for is not hidden by the reporter.
  expect(onFailure.mock.calls.length + toastError.mock.calls.length, "failures reported").toBe(reported);
  reported = 0;
  out.length = 0;
  onFailure.mockClear();
  toastError.mockClear();
});

/** How many failures the running test expects reported. */
let reported = 0;

describe("an attach in flight", () => {
  it("is detached when it lands after the cache removed its entry", async () => {
    const queryClient = cache();
    const { opened, first } = await attaching(queryClient);
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    await expect(opened).rejects.toBeInstanceOf(CancelledError);
    expect(first.detach).not.toHaveBeenCalled();
    first.land();
    await vi.waitFor(() => expect(first.detach).toHaveBeenCalledTimes(1));
  });

  it("is detached when it lands after the cache was reset, as switching workspace does", async () => {
    const queryClient = cache();
    const { opened, first } = await attaching(queryClient);
    await queryClient.resetQueries();
    await expect(opened).rejects.toBeInstanceOf(CancelledError);
    first.land();
    await vi.waitFor(() => expect(first.detach).toHaveBeenCalledTimes(1));
  });

  it("is kept when it lands with its entry still there, until the cache removes it", async () => {
    const queryClient = cache();
    const first = await attached(queryClient);
    expect(first.detach).not.toHaveBeenCalled();
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(first.detach).toHaveBeenCalledTimes(1);
  });
});

describe("an attachment the entry holds", () => {
  it("is detached once when the cache resets the entry to no data", async () => {
    const queryClient = cache();
    const first = await attached(queryClient);
    await queryClient.resetQueries();
    expect(queryClient.getQueryData(corpusKey(GRAPH))).toBeUndefined();
    expect(first.detach).toHaveBeenCalledTimes(1);
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(first.detach).toHaveBeenCalledTimes(1);
  });

  it("is detached once a refetch replaces it, and the new one is kept", async () => {
    const queryClient = cache();
    const first = await attached(queryClient);
    const refetched = queryClient.refetchQueries({ queryKey: corpusKey(GRAPH) });
    const second = await attachOut(2);
    expect(first.detach, "the entry still holds it while the new one is out").not.toHaveBeenCalled();
    second.land();
    await refetched;
    expect(first.detach).toHaveBeenCalledTimes(1);
    expect(second.detach).not.toHaveBeenCalled();
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(first.detach).toHaveBeenCalledTimes(1);
    expect(second.detach).toHaveBeenCalledTimes(1);
  });

  it("is not detached under a reader by a reset, only once the entry has its new one", async () => {
    const queryClient = cache();
    const unsubscribe = reader(queryClient);
    const first = await attachOut(1);
    first.land();
    await vi.waitFor(() => expect(queryClient.getQueryData(corpusKey(GRAPH))).toBeDefined());
    // The reader stays: the reset refetches the entry it holds.
    void queryClient.resetQueries();
    const second = await attachOut(2);
    expect(first.detach, "a reader still holds the entry").not.toHaveBeenCalled();
    second.land();
    await vi.waitFor(() => expect(first.detach).toHaveBeenCalledTimes(1));
    expect(second.detach).not.toHaveBeenCalled();
    unsubscribe();
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(first.detach).toHaveBeenCalledTimes(1);
    expect(second.detach).toHaveBeenCalledTimes(1);
  });

  it("held through a reset under a reader, is detached once when the entry is removed before a new one lands", async () => {
    const queryClient = cache();
    const unsubscribe = reader(queryClient);
    const first = await attachOut(1);
    first.land();
    await vi.waitFor(() => expect(queryClient.getQueryData(corpusKey(GRAPH))).toBeDefined());
    void queryClient.resetQueries();
    const second = await attachOut(2);
    unsubscribe();
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    expect(first.detach).toHaveBeenCalledTimes(1);
    // The new attach, given up on while out, detaches itself when it lands.
    second.land();
    await vi.waitFor(() => expect(second.detach).toHaveBeenCalledTimes(1));
    expect(first.detach).toHaveBeenCalledTimes(1);
  });
});

describe("a detach that fails", () => {
  const refused = new Error("DETACH refused");

  it("reaches the failure path once when the cache releases the entry", async () => {
    const queryClient = cache();
    const first = await attached(queryClient);
    first.detach.mockRejectedValueOnce(refused);
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(onFailure).toHaveBeenCalledWith(refused);
    queryClient.clear();
    await Promise.resolve();
    expect(onFailure).toHaveBeenCalledTimes(1);
    reported = 1;
  });

  it("reaches the failure path once when a replaced attachment is released", async () => {
    const queryClient = cache();
    const first = await attached(queryClient);
    first.detach.mockRejectedValueOnce(refused);
    const refetched = queryClient.refetchQueries({ queryKey: corpusKey(GRAPH) });
    (await attachOut(2)).land();
    await refetched;
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1));
    expect(onFailure).toHaveBeenCalledWith(refused);
    reported = 1;
  });

  it("of an attach the cache gave up on, is said once, with the release's title", async () => {
    const queryClient = cache();
    const { opened, first } = await attaching(queryClient);
    first.detach.mockRejectedValueOnce(refused);
    queryClient.removeQueries({ queryKey: corpusKey(GRAPH) });
    await expect(opened).rejects.toBeInstanceOf(CancelledError);
    first.land();
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(refused, RELEASE_FAILED);
    expect(onFailure).not.toHaveBeenCalled();
    reported = 1;
  });
});
