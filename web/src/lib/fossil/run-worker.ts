import { FossilError, isFossilError, type Access, type Host, type Problem, type RunReport, type Scope } from "@fossil-lang/types";

/**
 * A graph run off the page's main thread. fossil's executor builds its whole corpus in one call —
 * DataFusion over wasm, every source read and every Parquet written — and run on the page that call
 * holds the thread for as long as it takes: the page cannot paint, and its Stop cannot be pressed.
 * So the run is a worker's, and the page keeps the two things only it has: the `Host` (keasy's
 * session, its query cache) and the run's signal. Each crosses as messages over one port.
 *
 * - The worker asks the page for `connections()` and `credentials(…)`, each a request with an id,
 *   and the page answers it with its own host.
 * - The page's abort reaches the worker as a message; the worker stops the run with it.
 * - The run ends as its report, or as its failure: a `FossilError` crosses as its `Problem` and is
 *   rebuilt with `FossilError.from`, since an error loses its class through a structured clone.
 * - A host's refusal crosses the same way, and one that is not fossil's — keasy's `ApiError`, coded
 *   `store/refused` or `store/silent` — keeps its `code`, `title` and `data` as own properties of the
 *   error rebuilt in the worker: fossil reads a cause's `code` and `data` off any object it is
 *   rejected with, and an `Error` rebuilt from its words alone would leave the run's problem
 *   without the store's code under it.
 */

/** A failure as it crosses: fossil's as its `Problem`; any other as its name, words and code. */
export type Failure =
  | { problem: Problem }
  | { error: { name: string; message: string; code?: string; title?: string; data?: unknown } };

/** What crosses the port, page to worker and back. */
export type ToWorker =
  | { kind: "run"; program: string; job: string }
  | { kind: "abort" }
  | { kind: "answer"; id: number; value: unknown }
  | ({ kind: "refuse"; id: number } & Failure);

export type ToPage =
  | { kind: "ask"; id: number; method: "connections" }
  | { kind: "ask"; id: number; method: "credentials"; args: [Scope, Access] }
  | { kind: "done"; report: RunReport }
  | ({ kind: "failed" } & Failure)
  | { kind: "aborted" };

/** The part of a port both sides use: a `MessagePort`, or a worker's own scope. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  /** A `MessagePort` delivers nothing to an added listener until it is started. */
  start?(): void;
}

/** A failure as it crosses: its `Problem` when it is fossil's; its name, words and code otherwise. */
export function failureOf(error: unknown): Failure {
  if (isFossilError(error)) return { problem: error.problem };
  const own = (error ?? {}) as { name?: unknown; message?: unknown; code?: unknown; title?: unknown; data?: unknown };
  return {
    error: {
      name: typeof own.name === "string" ? own.name : "Error",
      message: typeof own.message === "string" ? own.message : String(error),
      ...(typeof own.code === "string" ? { code: own.code } : {}),
      ...(typeof own.title === "string" ? { title: own.title } : {}),
      ...(own.data !== null && typeof own.data === "object" ? { data: asJson(own.data) } : {}),
    },
  };
}

/** `data` as JSON keeps it — what fossil reads off a cause anyway — so the message always clones. */
function asJson(data: object): unknown {
  try {
    return JSON.parse(JSON.stringify(data)) as unknown;
  } catch {
    return undefined;
  }
}

/** The failure as the far side threw it: a `FossilError` again, or an `Error` with its code kept. */
export function rebuilt(failure: Failure): Error {
  if ("problem" in failure) return FossilError.from(failure.problem);
  const { name, message, ...coded } = failure.error;
  return Object.assign(new Error(message), { name }, coded);
}

/** The worker's side: wait for a run, run it with `execute` over a host that asks the page. */
export function serveRun(port: Port, execute: (program: string, options: { host: Host; job: string; signal: AbortSignal }) => Promise<RunReport>): void {
  const stop = new AbortController();
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  let next = 0;
  type Ask = { kind: "ask"; method: "connections" } | { kind: "ask"; method: "credentials"; args: [Scope, Access] };
  const ask = (message: Ask, signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      signal.addEventListener("abort", () => {
        pending.delete(id);
        reject(signal.reason);
      });
      port.postMessage({ ...message, id });
    });
  const host: Host = {
    connections: ({ signal }) => ask({ kind: "ask", method: "connections" }, signal) as Promise<Record<string, string>>,
    credentials: (scope, access, { signal }) =>
      ask({ kind: "ask", method: "credentials", args: [scope, access] }, signal) as ReturnType<Host["credentials"]>,
  };
  port.addEventListener("message", (event: MessageEvent<ToWorker>) => {
    const message = event.data;
    if (message.kind === "abort") stop.abort(new DOMException("Stopped", "AbortError"));
    else if (message.kind === "answer" || message.kind === "refuse") {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.kind === "answer") waiting?.resolve(message.value);
      else waiting?.reject(rebuilt(message));
    } else if (message.kind === "run") {
      execute(message.program, { host, job: message.job, signal: stop.signal }).then(
        (report) => port.postMessage({ kind: "done", report } satisfies ToPage),
        (error: unknown) => port.postMessage((stop.signal.aborted ? { kind: "aborted" } : { kind: "failed", ...failureOf(error) }) satisfies ToPage),
      );
    }
  });
  port.start?.();
}

/**
 * The page's side: `run(program, { host, job, signal })` as fossil's executor answers it, with the run
 * on the far side of `port`. Rejects with the run's `FossilError`, rebuilt, or with `signal`'s reason.
 */
export function runOver(port: Port, program: string, { host, job, signal }: { host: Host; job: string; signal?: AbortSignal }): Promise<RunReport> {
  return new Promise((resolve, reject) => {
    const calls = new AbortController();
    port.addEventListener("message", (event: MessageEvent<ToPage>) => {
      const message = event.data;
      if (message.kind === "ask") {
        const asked =
          message.method === "connections" ? host.connections({ signal: calls.signal }) : host.credentials(...message.args, { signal: calls.signal });
        asked.then(
          (value) => port.postMessage({ kind: "answer", id: message.id, value } satisfies ToWorker),
          (error: unknown) => port.postMessage({ kind: "refuse", id: message.id, ...failureOf(error) } satisfies ToWorker),
        );
      } else {
        calls.abort();
        if (message.kind === "done") resolve(message.report);
        else if (message.kind === "aborted") reject(signal?.reason ?? new DOMException("Stopped", "AbortError"));
        else reject(rebuilt(message));
      }
    });
    port.start?.();
    signal?.addEventListener("abort", () => port.postMessage({ kind: "abort" } satisfies ToWorker), { once: true });
    port.postMessage({ kind: "run", program, job } satisfies ToWorker);
  });
}

/**
 * fossil's `run(program, { host, job, signal })`, in a worker of its own that ends with the run. A
 * worker that cannot start — its module did not load — rejects with what the page was told.
 */
export function runInWorker(program: string, options: { host: Host; job: string; signal?: AbortSignal }): Promise<RunReport> {
  const worker = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
  const broken = new Promise<never>((_, reject) =>
    worker.addEventListener("error", (event) => reject(new Error(`The run's worker did not start: ${event.message}`)), { once: true }),
  );
  return Promise.race([runOver(worker, program, options), broken]).finally(() => worker.terminate());
}
