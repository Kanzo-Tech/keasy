import { useEffect, useRef, useState } from "react";
import { engine } from "@kanzo-tech/ui/analytics";
import { ApiError, http, type Schemas } from "@/lib/api/client";
import { bounds } from "@/lib/api/spec";
import { openJobCorpus, readCatalog } from "@/lib/fossil/corpus";
import { host } from "@/lib/fossil/host";
import { toastError, toProblem } from "@/lib/errors";

/**
 * How long the server waits on a running job before it sweeps it, as the server publishes it, and
 * how often the job says it is still being run: four times within it, so one lost beat is not an
 * abandoned run.
 */
export const LEASE_MS = bounds.job_lease_ms;
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
   * `send`, asked again on a transient failure until the lease would have expired; past that the
   * server's sweep owns the job, and the last failure is thrown.
   */
  report<T>(send: () => Promise<T>): Promise<T>;
}

export function lease(
  id: string,
  {
    beat = () => http.POST("/v1/jobs/{id}/heartbeat", { params: { path: { id } } }),
    now = Date.now,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = {},
): Lease {
  let renewed = now();
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    hold() {
      renewed = now();
      timer = setInterval(() => {
        beat().then(
          () => {
            renewed = now();
          },
          (err: unknown) => {
            // The job ended without us (the sweep, or another tab): nothing left to hold.
            if (!transient(err)) clearInterval(timer);
          },
        );
      }, HEARTBEAT_MS);
    },
    release() {
      clearInterval(timer);
    },
    async report(send) {
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

// Jobs whose browser run has been kicked off this session. Guards the detail
// view from re-triggering on re-render / poll-refetch. The run is idempotent by
// deterministic dest (`{sink}/{folder}`, the prefix of the credential keasy
// vends), so a stray double-run would only waste work — this avoids even that
// within a tab.
const started = new Set<string>();

/**
 * Browser-driven execution (client-compute): when a job is `Pending`, the
 * browser is its worker. Reads the program from the job record, marks it
 * `Running` (reusing the completion PATCH), then runs the mapping on
 * DataFusion-WASM end-to-end via `run` — sources and GraphAr output through
 * credentials keasy vends, outcome by `PATCH /v1/jobs/{id}`. The server never runs
 * the mapping. The detail view's existing poll surfaces the terminal status.
 */
export function useBrowserJobRunner(job: Schemas["Job"] | undefined): { stop?: () => void } {
  const ranRef = useRef(false);
  const [stop, setStop] = useState<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (!job || job.status !== "pending" || !job.script) return;
    if (ranRef.current || started.has(job.id)) return;
    ranRef.current = true;
    started.add(job.id);

    const program = job.script;
    const jobId = job.id;
    const held = lease(jobId);
    const run = new AbortController();
    // The corpus is written: from here on a failure is keasy's record of it, never the run's.
    let ran = false;
    // A closed tab stops the run; it cannot report, so the server's lease sweep ends the job.
    const closing = () => run.abort(new DOMException("The tab closed", "AbortError"));
    window.addEventListener("pagehide", closing);
    // Stop: the person's own end to it, reported as `cancelled`.
    setStop(() => () => run.abort(new DOMException("Stopped", "AbortError")));

    void (async () => {
      try {
        // Start marker: flip Pending → Running. Reuses the completion PATCH so
        // the UI (and any other viewer) sees it in progress.
        await http.PATCH("/v1/jobs/{id}", {
          params: { path: { id: jobId } },
          body: { status: "running" },
        });
        // While this tab runs the job it says so; a closed tab stops saying it,
        // and the server ends the job as `job/abandoned`.
        held.hold();

        const mod = await import("@fossil-lang/executor");
        await mod.initFossilExecutor();
        // `run` reads every document and source the program names through the host, writes the
        // corpus under the job, and answers its report or throws its `FossilError`. Recording the
        // outcome is keasy's: the report crosses untouched, since `CompleteJobRequest.manifest` is
        // opaque JSON on the server, and it is asked again for as long as the lease is ours.
        const report = await mod.run(program, { host, job: jobId, signal: run.signal });
        ran = true;
        await held.report(() =>
          http.PATCH("/v1/jobs/{id}", {
            params: { path: { id: jobId } },
            body: { status: "completed", manifest: report },
          }),
        );
        held.release();

        // Tell the host what it is now storing. The run report says what was
        // written; it does not say what the relations are CALLED, which is a
        // reader's answer — so the corpus is attached and asked, here, in the tab
        // that just produced it.
        //
        // Its own `catch`: the job IS done and its data IS at the sink. A
        // failure here loses the datasets entry, not the run, and reporting it as
        // a failed run would be a lie about durable data — so it is said, not
        // stored.
        try {
          const close = await openJobCorpus(jobId);
          try {
            const { coordinator } = await engine();
            const { vertex_tables, edge_tables } = await readCatalog(coordinator, jobId);
            // `fossil_tables` names each table's file relative to the corpus root, which is how
            // keasy stores it.
            const relation = (t: { name: string; record_count: number; path: string }) => ({
              name: t.name,
              rows: t.record_count,
              files: [t.path],
            });
            const relations = [
              ...vertex_tables.map((t) => ({
                ...relation(t),
                columns: t.properties.map((p) => ({ name: p.name, data_type: p.type })),
              })),
              ...edge_tables.map(relation),
            ];
            await held.report(() =>
              http.PUT("/v1/jobs/{id}/relations", { params: { path: { id: jobId } }, body: { relations } }),
            );
          } finally {
            await close();
          }
        } catch (err) {
          toastError(err, "The datasets entry was not published");
        }
      } catch (err) {
        if (ran) {
          // The output was written; only its report failed, and reporting a failure would be a lie.
          toastError(err, "The run finished, but keasy could not record it");
        } else if (run.signal.aborted) {
          // Stopped here: say so. A closed tab cannot, and the sweep ends the job instead.
          if (run.signal.reason instanceof DOMException && run.signal.reason.message === "Stopped") {
            await held
              .report(() => http.PATCH("/v1/jobs/{id}", { params: { path: { id: jobId } }, body: { status: "cancelled" } }))
              .catch((patchErr: unknown) => toastError(patchErr, "The run stopped, and the job could not be marked so"));
          }
        } else {
          // The run failed — its `FossilError`, whose `problem` is the wire form — or never started:
          // the executor did not load, or the job could not be marked running. Asked again until the
          // lease would lapse; after that the sweep ends the job anyway, as `job/abandoned`, and the
          // problem is said here.
          await held
            .report(() =>
              http.PATCH("/v1/jobs/{id}", {
                params: { path: { id: jobId } },
                body: { status: "failed", problem: toProblem(err) },
              }),
            )
            .catch((patchErr: unknown) =>
              toastError(patchErr, "The run failed, and the job could not be marked failed"),
            );
        }
      } finally {
        held.release();
        window.removeEventListener("pagehide", closing);
        setStop(undefined);
      }
    })();
    // Key off the stable fields, not the `job` object — the 3s poll allocates a
    // fresh object each tick, which would needlessly re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.script]);

  return { stop };
}
