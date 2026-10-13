/**
 * The one place keasy's web bounds a wait on something outside the process: every `fetch` goes
 * through {@link deadlineFetch}. The session store is bounded by `@kanzo-tech/auth`'s `ticketStore`.
 * A deadline that fires is coded by who did not answer, never as a bare timeout.
 */

/** Any API request from the browser, and a stream's next chunk: the G1 table's figures. */
export const DEADLINE_MS = 30_000;

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * `fetch`, with the response's headers due within `ms` and each chunk of its body within `ms` of the
 * last — so a JSON answer and a stream are bounded alike, and a stream whose server sends keep-alives
 * is never cut while it is alive. When the deadline fires, the request is aborted and `silent(ms)` is
 * what the caller sees, from the `fetch` or from the body read. A caller's own `signal` still aborts
 * as itself.
 */
export function deadlineFetch(silent: (ms: number) => Error, ms: number = DEADLINE_MS): typeof fetch {
  return async (input, init) => {
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
