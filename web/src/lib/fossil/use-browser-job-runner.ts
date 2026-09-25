import { useEffect, useRef } from "react";
import { http, type Schemas } from "@/lib/api/client";
import { makeJob } from "./job-transport";
import { openJobCorpus, relationsOf } from "./open-job-corpus";

// Jobs whose browser run has been kicked off this session. Guards the detail
// view from re-triggering on re-render / poll-refetch. The run is idempotent by
// deterministic dest (`{owner_base}/{job_id}`), so a stray double-run would only
// waste work — this avoids even that within a tab.
const started = new Set<string>();

/**
 * Browser-driven execution (client-compute): when a job is `Pending`, the
 * browser is its worker. Reads the program from the job record, marks it
 * `Running` (reusing the completion PATCH), then runs the mapping on
 * DataFusion-WASM end-to-end via `runJob` — sources by signed GET, GraphAr
 * output by signed PUT, outcome by `PATCH /v1/jobs/{id}`. The server never runs
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
        // host, and reports the terminal `completed`/`failed` PATCH itself.
        await mod.runJob(program, makeJob(jobId));

        // Tell the host what it is now storing. The run report says what was
        // written; it does not say what the relations are CALLED, which is a
        // reader's answer — so the corpus is opened and asked, here, in the tab
        // that just produced it.
        //
        // Its own `catch`: the job IS done and its data IS at the sink. A
        // failure here loses the datasets entry, not the run, and reporting it as
        // a failed run would be a lie about durable data.
        try {
          const { corpus } = await openJobCorpus(jobId);
          await http.PUT("/v1/jobs/{id}/relations", {
            params: { path: { id: jobId } },
            body: { relations: await relationsOf(corpus) },
          });
        } catch (err) {
          console.error(`publishing the corpus relations failed (${jobId})`, err);
        }
      } catch (err) {
        // runJob already best-effort PATCHes `failed`; nothing else to do but log.
        console.error(`browser job run failed (${jobId})`, err);
      }
    })();
    // Key off the stable fields, not the `job` object — the 3s poll allocates a
    // fresh object each tick, which would needlessly re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.script]);
}
