import { useSyncExternalStore } from "react";
import { ApiError, http, invalidate, type Schemas } from "@/lib/api/client";
import { bounds } from "@/lib/api/spec";
import { host } from "@/lib/fossil/host";
import { toastError, wireOf } from "@/lib/errors";

/**
 * How long the server waits on a running graph before it sweeps it, as the server publishes it, and
 * how often the graph says it is still being run: four times within it, so one lost beat is not an
 * abandoned run.
 */
export const LEASE_MS = bounds.graph_lease_ms;
export const HEARTBEAT_MS = LEASE_MS / 4;

/** A failure worth asking again: no answer, a server failure or a rate limit — never a refusal. */
function transient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === undefined || err.status >= 500 || err.status === 429;
}

export interface Lease {
  /** Start renewing the lease every {@link HEARTBEAT_MS}. */
  hold(): void;
  release(): void;
  /**
   * The run's end: the heartbeat stops and its beat still out lands first, so the end is the last
   * thing the server hears — a beat taken after it is refused `graph/ended`. Then `send`, asked again
   * on a transient failure until the lease would have expired; past that the server's sweep owns the
   * graph, and the last failure is thrown.
   */
  report<T>(send: () => Promise<T>): Promise<T>;
}

/**
 * What the runner reports of graph `id`: that it still runs (renewing the lease), or how it ended. The
 * answer says whether someone asked the run to stop.
 */
export async function reportStatus(
  id: string,
  body: Schemas["GraphStatusReport"],
): Promise<Schemas["RunSignal"] | undefined> {
  const { data } = await http.POST("/v1/graphs/{id}/status", { params: { path: { id } }, body });
  return data;
}

export function lease(
  id: string,
  {
    // `running`, sent again, is the heartbeat: it renews the lease.
    beat = () => reportStatus(id, { status: "running" }),
    // Someone asked the run to stop, from this page or another: the run aborts and reports it.
    onStopAsked = () => {},
    now = Date.now,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    beat?: () => Promise<Schemas["RunSignal"] | undefined>;
    onStopAsked?: () => void;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Lease {
  let renewed = now();
  let timer: ReturnType<typeof setInterval> | undefined;
  // The beat still out, if any. One writer: a beat is not sent while another is out, and the end
  // waits for it, as the server takes requests in any order.
  let beating: Promise<void> | undefined;
  return {
    hold() {
      renewed = now();
      timer = setInterval(() => {
        if (beating) return;
        beating = beat()
          .then(
            (signal) => {
              renewed = now();
              if (signal?.cancel_requested) onStopAsked();
            },
            (err: unknown) => {
              // The graph ended without us (the sweep, or another tab): nothing left to hold.
              if (!transient(err)) clearInterval(timer);
            },
          )
          .finally(() => {
            beating = undefined;
          });
      }, HEARTBEAT_MS);
    },
    release() {
      clearInterval(timer);
    },
    async report(send) {
      clearInterval(timer);
      // Settles either way: the beat's own handlers have had its answer.
      await beating;
      for (let delay = 1_000; ; delay = Math.min(delay * 2, 8_000)) {
        try {
          return await send();
        } catch (err) {
          if (!transient(err) || now() + delay - renewed >= LEASE_MS) throw err;
          await wait(delay);
        }
      }
    },
  };
}

/** A run this tab is running: what the page re-attaches to when it is opened again. */
export interface LiveRun {
  /** End it here, now, and report it `cancelled`. */
  stop(): void;
}

// The runs this tab runs, by graph id. Module-level, so a run outlives the page that started it:
// navigating inside the app keeps it running, and opening the page again finds it, with its Stop.
const live = new Map<string, LiveRun>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The run this tab runs for graph `id`, if any. */
export function useLiveRun(id: string): LiveRun | undefined {
  return useSyncExternalStore(
    subscribe,
    () => live.get(id),
    () => undefined,
  );
}

const STOPPED = "Stopped";

/**
 * Run `graph` here — the server has made this caller its runner (`POST /v1/graphs/{id}/run`). The browser
 * is the worker: it runs the program with fossil's executor (`run`) — sources read and the corpus
 * written through credentials keasy vends to the runner alone — holding the lease while it does, and
 * reports how it ended. Only ever called from an explicit Run; opening a page never runs anything.
 */
export function startRun(graph: Schemas["Graph"]): void {
  const graphId = graph.id;
  const program = graph.script;
  if (live.has(graphId) || !program) return;

  const run = new AbortController();
  const stop = () => run.abort(new DOMException(STOPPED, "AbortError"));
  const held = lease(graphId, { onStopAsked: stop });
  // The corpus is written: from here on a failure is keasy's record of it, never the run's.
  let ran = false;
  // A closed tab stops the run; it cannot report, so the server's lease sweep ends the graph.
  const closing = () => run.abort(new DOMException("The tab closed", "AbortError"));
  window.addEventListener("pagehide", closing);
  live.set(graphId, { stop });
  changed();
  held.hold();

  void (async () => {
    try {
      const mod = await import("@fossil-lang/executor");
      // `run` reads every document and source the program names through the host, writes the
      // corpus under the graph, and answers its report or throws its `FossilError`. The report crosses
      // untouched — `GraphStatusReport.report` is opaque JSON on the server — and is asked again for as
      // long as the lease is ours.
      const report = await mod.run(program, { host, job: graphId, signal: run.signal });
      ran = true;
      await held.report(() => reportStatus(graphId, { status: "completed", report }));
    } catch (err) {
      if (ran) {
        // The output was written; only its report failed, and reporting a failure would be a lie.
        toastError(err, "The run finished, but keasy could not record it");
      } else if (run.signal.aborted) {
        // Stopped — here, or asked from elsewhere and heard in a beat: say so. A closed tab cannot,
        // and the sweep ends the graph instead.
        if (run.signal.reason instanceof DOMException && run.signal.reason.message === STOPPED) {
          await held
            .report(() => reportStatus(graphId, { status: "cancelled" }))
            .catch((patchErr: unknown) => toastError(patchErr, "The run stopped, and could not be marked so"));
        }
      } else {
        // The run failed — its `FossilError`, whose `problem` is the wire form — or never started:
        // the executor did not load. Asked again until the lease would lapse; after that the sweep
        // ends the graph anyway, as `graph/abandoned`, and the problem is said here.
        await held
          .report(() => reportStatus(graphId, { status: "failed", problem: wireOf(err) }))
          .catch((patchErr: unknown) => toastError(patchErr, "The run failed, and could not be marked failed"));
      }
    } finally {
      held.release();
      window.removeEventListener("pagehide", closing);
      live.delete(graphId);
      changed();
      await invalidate("/v1/graphs", "/v1/graphs/{id}");
    }
  })();
}

/**
 * End a run of ours that no tab runs any more — the page that ran it reloaded or closed — as
 * `failed` with `graph/interrupted`, so it can be run again at once instead of waiting for the sweep.
 */
export async function markInterrupted(id: string): Promise<void> {
  await reportStatus(id, {
    status: "failed",
    problem: {
      code: "graph/interrupted",
      title: "The run was interrupted",
      detail: "The tab running it reloaded or closed before it finished.",
      data: {},
    },
  });
}
