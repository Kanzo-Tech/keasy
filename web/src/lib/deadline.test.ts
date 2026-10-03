import { afterEach, describe, expect, it, vi } from "vitest";

import { deadlineFetch } from "./deadline";

class Silent extends Error {
  constructor(readonly after: number) {
    super(`silent after ${after}`);
  }
}

/** A fetch that never answers, until its signal aborts it. */
function silentFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the deadline", () => {
  it("names who did not answer when the headers never come", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", silentFetch());
    const answer = deadlineFetch((ms) => new Silent(ms), 30_000)("/api/v1/jobs");
    const settled = expect(answer).rejects.toMatchObject({ after: 30_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
  });

  it("cuts a body that stops mid-way, chunk by chunk, not the whole stream", async () => {
    vi.useFakeTimers();
    let push: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            push = controller;
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body);
      }),
    );
    const response = await deadlineFetch((ms) => new Silent(ms), 1_000)("/api/v1/jobs/7/events");
    const reader = response.body!.getReader();

    for (let i = 0; i < 3; i++) {
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(900);
      push!.enqueue(new Uint8Array([i]));
      expect((await next).value).toEqual(new Uint8Array([i]));
    }
    const stalled = expect(reader.read()).rejects.toMatchObject({ after: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    await stalled;
  });

  it("leaves a model call to the gateway, which bounds it itself", async () => {
    vi.useFakeTimers();
    const fetch = silentFetch();
    vi.stubGlobal("fetch", fetch);
    const stop = new AbortController();
    const init = { method: "POST", signal: stop.signal };
    const url = "https://keasy.test/api/v1/ai/chat/completions";
    let settled = false;
    const answer = deadlineFetch((ms) => new Silent(ms), 1_000)(url, init);
    answer.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    expect(fetch).toHaveBeenCalledWith(url, init);
    stop.abort(new Error("stopped"));
    await expect(answer).rejects.toThrow("stopped");
  });

  it("lets a caller's own abort be itself", async () => {
    vi.stubGlobal("fetch", silentFetch());
    const stop = new AbortController();
    const answer = deadlineFetch((ms) => new Silent(ms))("/x", { signal: stop.signal });
    stop.abort(new Error("stopped"));
    await expect(answer).rejects.toThrow("stopped");
  });
});
