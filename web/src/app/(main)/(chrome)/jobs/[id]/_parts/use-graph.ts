import { $api, type Schemas } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { isRunning, pollWhile } from "@/lib/jobs";

/** The graph `id`, polled while it runs: the header and every tab read this one query. */
export function useGraph(id: string): Schemas["Job"] {
  return settled(
    $api.useSuspenseQuery(
      "get",
      "/v1/jobs/{id}",
      { params: { path: { id } } },
      { refetchInterval: pollWhile<Schemas["Job"]>((job) => !!job && isRunning(job.status)) },
    ),
  );
}
