import type { SourceHost } from "@fossil-lang/types";

import { http } from "@/lib/api/client";
import { storageOf } from "@/lib/connections";
import { queryClient } from "@/lib/query-client";

/**
 * keasy as fossil's `SourceHost` — the editor's and a job run's alike. Fossil
 * decides what a program reads and expands every `@name/…` into a locator; keasy
 * only hands over the source connections' prefixes and signs locators with the
 * credential of the connection each one lies under.
 *
 * The editor asks for the map on every check, so it reads the connection list
 * through the query cache under `/v1/connections`: `invalidate("/v1/connections")`
 * after adding or deleting one drops it.
 */
export const sourceHost: SourceHost = {
  connections: async () => {
    const connections = await queryClient.fetchQuery({
      queryKey: ["get", "/v1/connections", {}],
      queryFn: async () => (await http.GET("/v1/connections")).data ?? [],
      staleTime: 60_000,
    });
    return Object.fromEntries(
      connections.flatMap((c) => {
        const storage = storageOf(c);
        return storage?.direction === "source" ? [[c.name, storage.url]] : [];
      }),
    );
  },
  sign: async (locators) =>
    (await http.POST("/v1/connections/urls", { body: { locators } })).data?.urls ?? {},
};
