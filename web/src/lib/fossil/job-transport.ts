import type { CompletePayload, Job } from "@fossil-lang/executor";
import { api } from "@/lib/api";
import { sourceHost } from "./source-host";

/**
 * A job as `@fossil-lang/executor`'s `runJob` takes it: what it reads goes
 * through keasy's one {@link sourceHost}; what is its own is the output it
 * uploads and the outcome it reports.
 *
 * `report` crosses untouched: `CompleteJobRequest.manifest` is opaque JSON on
 * the server, so there is nothing to map and nothing keasy could map it to.
 */
export function makeJob(id: string): Job {
  return {
    host: sourceHost,
    output: {
      signOutputUrls: (paths: string[]) => api.jobs.signOutputUrls(id, paths),
      complete: async (req: CompletePayload): Promise<void> => {
        await api.jobs.complete(id, {
          status: req.status,
          manifest: req.manifest,
          error: req.error,
        });
      },
    },
  };
}
