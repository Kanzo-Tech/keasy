import { run } from "@fossil-lang/executor";
import type { Host, Profiled, RunReport } from "@fossil-lang/types";

/**
 * keasy's one door to fossil's executor: every run — a graph's, written under its job, and the
 * assistant's preview, answered in memory — goes through {@link runInto}, so a change to fossil's
 * `run` is one edit here.
 *
 * fossil 0.3.0-alpha.31's `run(program, { host, into, … })` says where the corpus goes: `{ job }`
 * writes it under the job's prefix with a credential the host vends, and answers the report;
 * `"memory"`, with a `limit` of rows per source, writes nothing and answers the corpus's files.
 */

/** The rows of each source a preview reads. */
export const PREVIEW_ROWS = 200;

/** One file of a corpus answered in memory: its path under the corpus's root, and its bytes. */
export interface CorpusFile {
  /** `fossil.json`, `vertex/<Type>.parquet`, … */
  path: string;
  bytes: Uint8Array;
}

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

/** fossil's `run`, as alpha.31 types it. */
interface FossilRun {
  (program: string, options: { host: Host; into: { job: string }; profiled?: Profiled; signal?: AbortSignal }): Promise<RunReport>;
  (
    program: string,
    options: { host: Host; into: "memory"; limit: number; profiled?: Profiled; signal?: AbortSignal },
  ): Promise<{ report: RunReport; files: CorpusFile[] }>;
}

// The published alpha.30 still types `run` as `{ host, job }`; alpha.31's `into` is the shape above.
// Once alpha.31 is installed, this assertion is the one line to drop.
const fossilRun = run as unknown as FossilRun;

/** Run `program` into `into` (see {@link Into}). Rejects with fossil's `FossilError`, or `signal`'s reason. */
export async function runInto(program: string, { host, into, profiled, signal }: RunInto): Promise<Ran> {
  const asked = { host, ...(profiled === undefined ? {} : { profiled }), ...(signal === undefined ? {} : { signal }) };
  if (into === "memory") return fossilRun(program, { ...asked, into, limit: PREVIEW_ROWS });
  return { report: await fossilRun(program, { ...asked, into }), files: [] };
}
