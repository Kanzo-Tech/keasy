import type { CompletePayload, Job } from "@fossil-lang/executor";
import { http } from "@/lib/api/client";
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
      signOutputUrls: async (paths: string[]) =>
        (await http.POST("/v1/jobs/{id}/output/urls", { params: { path: { id } }, body: { paths } }))
          .data!.files,
      complete: async (req: CompletePayload): Promise<void> => {
        await http.PATCH("/v1/jobs/{id}", {
          params: { path: { id } },
          body: {
          status: req.status,
          manifest: req.manifest,
          error: req.error,
          },
        });
      },
    },
  };
}
