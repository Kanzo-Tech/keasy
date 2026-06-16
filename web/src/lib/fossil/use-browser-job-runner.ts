import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { refs as fossilRefs } from "./lineage";
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

// Azure block-blob uploads via SAS REQUIRE the `x-ms-blob-type: BlockBlob`
// header; the executor's uploader is provider-agnostic and omits it → Azure
// rejects the PUT with 400 (MissingRequiredHeader). Inject it on PUTs through
// the executor's `fetchImpl` hook. S3/GCS presigned PUTs ignore the unsigned
// header, so this is safe across providers. (Proper home is the executor's
// uploader in `@fossil-lang/executor`; this unblocks Azure destinations now.)
const uploadFetch: typeof fetch = (input, init) => {
  if (init?.method === "PUT") {
    const headers = new Headers(init.headers);
    headers.set("x-ms-blob-type", "BlockBlob");
    return fetch(input, { ...init, headers });
  }
  return fetch(input, init);
};

/**
 * Resolve the program's output ShEx so the executor shapes the GraphAr graph
 * (edges + typed props). The browser executor stubs out its filesystem, so it
 * never reads the `schema = "@conn/x.shex"` the program declares in `io.rdf`;
 * with no `shex` it falls back to `ACCEPT_ALL_DEFAULT` → every RDF object
 * becomes a literal vertex property and NO edges are emitted. We hand it the
 * same schema the program already references: ask fossil for the program's
 * typed lineage (client-compute `refs()` in `@fossil-lang/wasm` — no regex, no
 * server), take the `schema` ref, resolve it through the job's connection
 * ref-map exactly like the executor's
 * `resolve_source_uri` (`@name/path` → `{base}/path`), sign it, and fetch the
 * text. Returns `undefined` when the program declares no schema ref (then the
 * executor keeps its accept-all behaviour, as before).
 */
async function resolveOutputShex(program: string, jobId: string): Promise<string | undefined> {
  const schemaRef = (await fossilRefs(program)).find((r) => r.role === "schema");
  if (!schemaRef) return undefined;

  const refMap = await api.jobs.sourceRefs(jobId);
  const base = schemaRef.connection ? refMap[schemaRef.connection] : undefined;
  const uri = base
    ? `${base.replace(/\/+$/, "")}/${schemaRef.path}`
    : schemaRef.connection
      ? `@${schemaRef.connection}/${schemaRef.path}` // unknown alias: leave verbatim (the fetch surfaces the real error)
      : schemaRef.path;

  const signed = await api.jobs.signSourceUrls(jobId, [uri]);
  const res = await fetch(signed[uri] ?? uri);
  if (!res.ok) throw new Error(`fetch output ShEx ${uri}: ${res.status}`);
  return res.text();
}

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

        // Resolve the output shape BEFORE loading the heavy executor — a cheap
        // `/v1/refs` + sign + fetch. Drives edge generation (see helper).
        const shex = await resolveOutputShex(program, jobId);

        const mod = await import("@fossil-lang/executor");
        await mod.initFossilExecutor({ wasmUrl: DF_WASM_URL });
        exec = new mod.FossilExecutor();
        // runJob reports the terminal `completed`/`failed` PATCH itself.
        await mod.runJob(exec, program, makeJobTransport(jobId), { fetchImpl: uploadFetch, shex });
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
