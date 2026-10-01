import { useEffect, useRef } from "react";
import type { Job } from "@fossil-lang/executor";
import { http, type Schemas } from "@/lib/api/client";
import { openJobCorpus } from "@/lib/fossil/corpus";
import { host } from "@/lib/fossil/host";
import { toastError, toProblem } from "@/lib/errors";

/**
 * A job as `runJob` takes it: every byte goes through keasy's one {@link host};
 * the run report crosses untouched, since `CompleteJobRequest.manifest` is
 * opaque JSON on the server. A failure is reported by the runner instead, which
 * holds every failure — the executor's and its own — in one `catch`.
 */
function makeJob(id: string): Job {
  return {
    id,
    host,
    complete: async ({ status, manifest }) => {
      if (status === "failed") return;
      await http.PATCH("/v1/jobs/{id}", { params: { path: { id } }, body: { status, manifest } });
    },
  };
}

// Jobs whose browser run has been kicked off this session. Guards the detail
// view from re-triggering on re-render / poll-refetch. The run is idempotent by
// deterministic dest (`{owner_base}/{job_id}`), so a stray double-run would only
// waste work — this avoids even that within a tab.
const started = new Set<string>();

/**
 * Browser-driven execution (client-compute): when a job is `Pending`, the
 * browser is its worker. Reads the program from the job record, marks it
 * `Running` (reusing the completion PATCH), then runs the mapping on
 * DataFusion-WASM end-to-end via `runJob` — sources and GraphAr output through
 * credentials keasy vends, outcome by `PATCH /v1/jobs/{id}`. The server never runs
 * the mapping. The detail view's existing poll surfaces the terminal status.
 */
export function useBrowserJobRunner(job: Schemas["Job"] | undefined): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!job || job.status !== "pending" || !job.script) return;
    if (ranRef.current || started.has(job.id)) return;
    ranRef.current = true;
    started.add(job.id);

    const program = job.script;
    const jobId = job.id;

    void (async () => {
      try {
        // Start marker: flip Pending → Running. Reuses the completion PATCH so
        // the UI (and any other viewer) sees it in progress.
        await http.PATCH("/v1/jobs/{id}", {
          params: { path: { id: jobId } },
          body: { status: "running" },
        });

        const mod = await import("@fossil-lang/executor");
        await mod.initFossilExecutor();
        // runJob reads every document and source the program names through the
        // host, and reports `completed` itself; a failure is PATCHed below.
        await mod.runJob(program, makeJob(jobId));

        // Tell the host what it is now storing. The run report says what was
        // written; it does not say what the relations are CALLED, which is a
        // reader's answer — so the corpus is opened and asked, here, in the tab
        // that just produced it.
        //
        // Its own `catch`: the job IS done and its data IS at the sink. A
        // failure here loses the datasets entry, not the run, and reporting it as
        // a failed run would be a lie about durable data — so it is said, not
        // stored.
        try {
          const corpus = await openJobCorpus(jobId);
          try {
            // The manifest names each table's file relative to the corpus root, which is
            // how keasy stores it.
            const relation = (t: { name: string; record_count: number; path: string }) => ({
              name: t.name,
              rows: t.record_count,
              files: [t.path],
            });
            const { vertex_tables, edge_tables } = corpus.manifest;
            const relations = [
              ...vertex_tables.map((t) => ({
                ...relation(t),
                columns: t.properties.map((p) => ({ name: p.name, data_type: p.type })),
              })),
              ...edge_tables.map(relation),
            ];
            await http.PUT("/v1/jobs/{id}/relations", { params: { path: { id: jobId } }, body: { relations } });
          } finally {
            await corpus.close();
          }
        } catch (err) {
          toastError(err, "The datasets entry was not published");
        }
      } catch (err) {
        // The run's `FossilError`, or a failure before it: the executor never
        // loaded, or the job could not be marked running.
        await http
          .PATCH("/v1/jobs/{id}", {
            params: { path: { id: jobId } },
            body: { status: "failed", problem: toProblem(err) },
          })
          .catch((patchErr: unknown) => toastError(patchErr, "The run failed, and the job could not be marked failed"));
      }
    })();
    // Key off the stable fields, not the `job` object — the 3s poll allocates a
    // fresh object each tick, which would needlessly re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.script]);
}
