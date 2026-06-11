import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { Schemas } from "@/lib/api/client";
// Type-only — erased at compile time, so it does NOT eager-load the heavy wasm
// module (the runtime values come from the dynamic `import()` below).
import type { FossilExecutor } from "@fossil-lang/executor";
import { makeJobTransport } from "./job-transport";

// Served by `copy-fossil-wasm.mjs` (predev/prebuild) — the DataFusion-WASM
// executor artefact. Heavy (~lazy-loaded only when a job actually runs).
const DF_WASM_URL = "/fossil/fossil_df_wasm_bg.wasm";

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
    let exec: FossilExecutor | undefined;

    void (async () => {
      try {
        // Start marker: flip Pending → Running. Reuses the completion PATCH so
        // the UI (and any other viewer) sees it in progress.
        await api.jobs.complete(jobId, { status: "running" });

        const mod = await import("@fossil-lang/executor");
        await mod.initFossilExecutor({ wasmUrl: DF_WASM_URL });
        exec = new mod.FossilExecutor();
        // runJob reports the terminal `completed`/`failed` PATCH itself.
        await mod.runJob(exec, program, makeJobTransport(jobId));
      } catch (err) {
        // runJob already best-effort PATCHes `failed`; nothing else to do but log.
        console.error(`browser job run failed (${jobId})`, err);
      } finally {
        exec?.free();
      }
    })();
    // Key off the stable fields, not the `job` object — the 3s poll allocates a
    // fresh object each tick, which would needlessly re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.script]);
}
