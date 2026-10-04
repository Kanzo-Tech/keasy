import { $api, type Schemas } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { isRunning, pollWhile } from "@/lib/graphs";

/** The graph `id`, polled while it runs: the header and every tab read this one query. */
export function useGraph(id: string): Schemas["Graph"] {
  return settled(
    $api.useSuspenseQuery(
      "get",
      "/v1/graphs/{id}",
      { params: { path: { id } } },
      { refetchInterval: pollWhile<Schemas["Graph"]>((graph) => !!graph && isRunning(graph.status)) },
    ),
  );
}
