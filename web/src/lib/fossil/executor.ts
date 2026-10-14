import { run } from "@fossil-lang/executor";
import type { CorpusFile, Host, Profiled, RunReport } from "@fossil-lang/types";

/**
 * keasy's one door to fossil's executor: every run — a graph's, written under its job, and the
 * assistant's preview, answered in memory — goes through {@link runInto}, so a change to fossil's
 * `run` is one edit here.
 *
 * fossil 0.3.0-alpha.32's `run(program, { host, into, … })` runs in a worker of fossil's own, so the
 * page paints and a Stop is pressed while it does, and says where the corpus goes: `{ job }` writes it
 * under the job's prefix with a credential the host vends, and answers the report; `"memory"`, with a
 * `limit` of rows per source, writes nothing and answers the corpus's files.
 */

/** The rows of each source a preview reads. */
export const PREVIEW_ROWS = 200;

/** Where a run's corpus goes: under a job, or back to the caller over the first {@link PREVIEW_ROWS} rows. */
export type Into = { job: string } | "memory";

/** What a run is asked with. */
export interface RunInto {
  host: Host;
  into: Into;
  /** What the profile answered, so the run checks the program against the same columns. */
  profiled?: Profiled;
  signal?: AbortSignal;
}

/** How a run ended: its report, and — run into memory — the corpus's files; none under a job. */
export interface Ran {
  report: RunReport;
  files: CorpusFile[];
}

/** Run `program` into `into` (see {@link Into}). Rejects with fossil's `FossilError`, or `signal`'s reason. */
export async function runInto(program: string, { host, into, profiled, signal }: RunInto): Promise<Ran> {
  const asked = { host, ...(profiled === undefined ? {} : { profiled }), ...(signal === undefined ? {} : { signal }) };
  if (into === "memory") return run(program, { ...asked, into, limit: PREVIEW_ROWS });
  return { report: await run(program, { ...asked, into }), files: [] };
}
