import "client-only";

import type { Access, Host, Scope, StorageCredential } from "@fossil-lang/types";

import { http } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";

/**
 * keasy as fossil's `Host` — the editor's, a job run's and a corpus's alike.
 * Fossil decides what a program reads and expands every `@name/…` into a
 * locator; keasy hands over the source connections' prefixes and, for a scope,
 * a credential scoped to its prefix for an hour. Fossil reaches the store with
 * it and renews it before it expires; keasy never signs a URL.
 *
 * The editor asks for the map on every check, so it reads the connection list
 * through the query cache under `/v1/connections`: `invalidate("/v1/connections")`
 * after adding or deleting one drops it.
 */
export const host: Host = {
  connections: async () => {
    const connections = await queryClient.fetchQuery({
      queryKey: ["get", "/v1/connections", {}],
      queryFn: async () => (await http.GET("/v1/connections")).data ?? [],
      staleTime: 60_000,
    });
    return Object.fromEntries(
      connections.flatMap((c) => (c.target.direction === "source" ? [[c.name, c.target.url]] : [])),
    );
  },
  credentials: async (scope: Scope, access: Access): Promise<StorageCredential[]> => {
    const vended =
      "job" in scope
        ? await http.POST("/v1/jobs/{id}/credentials", { params: { path: { id: scope.job } }, body: { access } })
        : await http.POST("/v1/connections/{name}/credentials", {
            params: { path: { name: scope.connection } },
            body: { access },
          });
    return vended.data!.storage_credentials;
  },
};
