/**
 * Open a job's corpus — the one door keasy walks through to read an output.
 *
 * The host's whole job here is access. fossil reads its own index, names every
 * file the corpus needs, and lends them to the page's one engine under
 * `jobs/{id}/…`, with the views in a catalog of that name: two jobs open in one
 * page never meet. What keasy hands over is, for each of those paths, the URL
 * a reader holds while it reads — a same-origin locator the server redirects,
 * per request, to the store signed for that request's method.
 */

import "client-only";

import { open, type SqlCorpus } from "@fossil-lang/corpus";
import type { Signer } from "@fossil-lang/types";
import { engine } from "@kanzo-tech/ui/analytics";

/** The root of every cached read of a job's opened output; its own, so invalidating a job never reopens it. */
export const corpusKey = (jobId: string) => ["corpus", jobId] as const;

/** keasy as the signer of one job's dataset: a stable URL per dataset-relative path. */
const jobHost = (jobId: string): Signer => ({
  sign: async (paths) =>
    Object.fromEntries(
      paths.map((path) => [
        path,
        new URL(`/api/v1/jobs/${jobId}/objects?path=${encodeURIComponent(path)}`, location.origin).href,
      ]),
    ),
});

/** Open the corpus a completed job wrote. The caller closes it. */
export async function openJobCorpus(jobId: string): Promise<SqlCorpus> {
  return open(`jobs/${jobId}`, { engine: await engine(), host: jobHost(jobId), sql: "allowed" });
}
