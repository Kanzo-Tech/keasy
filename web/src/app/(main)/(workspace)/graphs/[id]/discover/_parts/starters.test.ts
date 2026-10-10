import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { startersQuery } from "./starters";

/** A stream the test feeds by hand: `push` lands one offer, `end` closes it; it stops on its signal. */
function gate<T>() {
  const queue: T[] = [];
  let wake = () => {};
  let ended = false;
  const stream = async function* (signal: AbortSignal) {
    while (!signal.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  };
  return {
    stream,
    push: (...items: T[]) => {
      queue.push(...items);
      wake();
    },
    end: () => {
      ended = true;
      wake();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const KEY = ["starters", "Person.gender = 'female'"];

describe("startersQuery", () => {
  it("leaves nothing behind for a filter whose stream was cut short, so going back to it asks again", async () => {
    const client = new QueryClient();
    const first = gate<string>();
    const observer = new QueryObserver(client, { queryKey: KEY, queryFn: startersQuery(({ signal }) => first.stream(signal)), staleTime: Infinity, retry: false });
    const off = observer.subscribe(() => {});
    await tick();
    first.push("Whom do women know?", "Which women share a city?");
    await tick();
    // The reader changes the filter: the panel stops watching this key, and its stream is aborted.
    off();
    await tick();
    first.push("A third, after the abort?");
    await tick();
    expect(client.getQueryData(KEY)).toBeUndefined();
    expect(client.getQueryState(KEY)?.status).toBe("pending");
  });

  it("replaces the last batch with the next for the same filter, never adding to it", async () => {
    const client = new QueryClient();
    const batches = [gate<string>(), gate<string>()];
    let call = 0;
    const observer = new QueryObserver(client, {
      queryKey: KEY,
      queryFn: startersQuery(({ signal }) => batches[call++]!.stream(signal)),
      staleTime: Infinity,
      retry: false,
    });
    const off = observer.subscribe(() => {});
    await tick();
    batches[0]!.push("a", "b", "c", "d");
    batches[0]!.end();
    await tick();
    await tick();
    expect(client.getQueryData(KEY)).toEqual(["a", "b", "c", "d"]);
    const again = observer.refetch();
    await tick();
    batches[1]!.push("e");
    await tick();
    expect(client.getQueryData<string[]>(KEY)!.length).toBeLessThanOrEqual(4);
    batches[1]!.push("f", "g", "h");
    batches[1]!.end();
    await again;
    expect(client.getQueryData(KEY)).toEqual(["e", "f", "g", "h"]);
    off();
  });
});
