import type { JobTransport, CompletePayload, ConnectionRefs } from "@fossil-lang/executor";
import { api } from "@/lib/api";

/**
 * keasy's `JobTransport` for `@fossil-lang/executor`'s `runJob` — wires the four
 * browser-driven job endpoints to `api.jobs.*` so the orchestration carries no
 * server coupling.
 *
 * `report` crosses untouched: `CompleteJobRequest.manifest` is opaque JSON on
 * the server, so there is nothing to map and nothing keasy could map it to. It
 * used to be a re-typed `RunStatus` on both sides, which is how the host ended
 * up asking for files the layout pass had already deleted.
 */
export function makeJobTransport(id: string): JobTransport {
  return {
    sourceRefs: (): Promise<ConnectionRefs> => api.jobs.sourceRefs(id),
    signSourceUrls: (uris: string[]) => api.jobs.signSourceUrls(id, uris),
    signOutputUrls: (paths: string[]) => api.jobs.signOutputUrls(id, paths),
    complete: async (req: CompletePayload): Promise<void> => {
      await api.jobs.complete(id, {
        status: req.status,
        manifest: req.manifest,
        error: req.error,
      });
    },
  };
}
