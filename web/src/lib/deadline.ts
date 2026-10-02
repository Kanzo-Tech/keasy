/**
 * The one place keasy's web bounds a wait on something outside the process. Every `fetch` goes
 * through {@link deadlineFetch}; every other outside promise (the session store) through
 * {@link race}. A deadline that fires is coded by who did not answer, never as a bare timeout.
 */

/** Any API request from the browser, and a stream's next chunk: the G1 table's figures. */
export const DEADLINE_MS = 30_000;

/** `promise`, or `silent()` thrown once `ms` pass without it settling. */
export function race<T>(promise: Promise<T>, ms: number, silent: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fired = new Promise<never>((_, reject) => {
    // One turn of the loop before rejecting: after a stall (a dev compile, a long GC) the timer
    // and the answer are due together, and the timer phase runs first.
    timer = setTimeout(() => setTimeout(() => reject(silent()), 0), ms);
  });
  return Promise.race([promise, fired]).finally(() => clearTimeout(timer));
}

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * A model call, which `@kanzo-tech/llm`'s `createGateway` bounds itself — its answer's start and
 * each chunk after — and names `ai/silent`. A second bound here would race it and call the same
 * silence `server/silent`, so the path is passed through whole.
 */
const MODEL_CALLS = "/api/v1/ai/";

function isModelCall(input: RequestInfo | URL): boolean {
  const url = input instanceof Request ? input.url : input.toString();
  return new URL(url, "http://origin.invalid").pathname.startsWith(MODEL_CALLS);
}

/**
 * `fetch`, with the response's headers due within `ms` and each chunk of its body within `ms` of the
 * last — so a JSON answer and a stream are bounded alike, and a stream whose server sends keep-alives
 * is never cut while it is alive. When the deadline fires, the request is aborted and `silent(ms)` is
 * what the caller sees, from the `fetch` or from the body read. A caller's own `signal` still aborts
 * as itself.
 */
export function deadlineFetch(silent: (ms: number) => Error, ms: number = DEADLINE_MS): typeof fetch {
  return async (input, init) => {
    if (isModelCall(input)) return globalThis.fetch(input, init);
    const outer = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const controller = new AbortController();
    const forward = () => controller.abort(outer?.reason);
    if (outer?.aborted) forward();
    else outer?.addEventListener("abort", forward, { once: true });

    let fired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(() => {
        fired = true;
        controller.abort(silent(ms));
      }, ms);
    };
    const named = (err: unknown) => (fired ? silent(ms) : err);

    arm();
    let response: Response;
    try {
      response = await globalThis.fetch(input, { ...init, signal: controller.signal });
    } catch (err) {
      throw named(err);
    } finally {
      clearTimeout(timer);
    }
    if (!response.body || NO_BODY.has(response.status)) return response;

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        arm();
        try {
          const { done, value } = await reader.read();
          if (done) stream.close();
          else stream.enqueue(value);
        } catch (err) {
          throw named(err);
        } finally {
          clearTimeout(timer);
        }
      },
      cancel(reason) {
        clearTimeout(timer);
        outer?.removeEventListener("abort", forward);
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
