/**
 * Open a job's corpus — the one door keasy walks through to read an output.
 *
 * The host's whole job here is access: fossil asks {@link host} for a read
 * credential on the job's dataset, installs it in the page's one engine scoped
 * to that prefix, renews it before it expires, and reads its own index.
 */

import "client-only";

import { open, type SqlCorpus } from "@fossil-lang/corpus";
import { engine } from "@kanzo-tech/ui/analytics";

import { host } from "@/lib/fossil/host";

/** The root of every cached read of a job's opened output; its own, so invalidating a job never reopens it. */
export const corpusKey = (jobId: string) => ["corpus", jobId] as const;

/** Open the corpus a completed job wrote. The caller closes it. */
export async function openJobCorpus(jobId: string): Promise<SqlCorpus> {
  return open(jobId, { engine: await engine(), host, sql: "allowed" });
}
