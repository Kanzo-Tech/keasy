import type { JobTransport, CompletePayload, ConnectionRefs } from "@fossil-lang/executor";
import { api } from "@/lib/api";
import type { Schemas } from "@/lib/api/client";

/**
 * keasy's `JobTransport` for `@fossil-lang/executor`'s `runJob` — wires the four
 * browser-driven job endpoints to `api.jobs.*` so the orchestration carries no
 * server coupling. The executor's `RunStatus` is the same `fossil-run-status`
 * wire shape as the codegen `CompleteJobRequest.manifest`, so the completion
 * mapping is a structural cast (no transformation).
 */
export function makeJobTransport(id: string): JobTransport {
  return {
    sourceRefs: (): Promise<ConnectionRefs> => api.jobs.sourceRefs(id),
    signSourceUrls: (uris: string[]) => api.jobs.signSourceUrls(id, uris),
    signOutputUrls: (paths: string[]) => api.jobs.signOutputUrls(id, paths),
    complete: async (req: CompletePayload): Promise<void> => {
      await api.jobs.complete(id, {
        status: req.status,
        manifest: req.manifest as Schemas["CompleteJobRequest"]["manifest"],
        error: req.error,
      });
    },
  };
}
