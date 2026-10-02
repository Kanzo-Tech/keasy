import "client-only";

import { type Access, type Host, type Scope, type StorageCredential, until } from "@fossil-lang/types";

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
  // `signal` is fossil's: the caller's Stop, or the 30 s a host has to answer. Passing it to the
  // request stops the request too, rather than leaving it to finish unread.
  connections: async ({ signal }) => {
    const connections = await until(
      queryClient.fetchQuery({
        queryKey: ["get", "/v1/connections", {}],
        queryFn: async ({ signal: query }) => (await http.GET("/v1/connections", { signal: query })).data ?? [],
        staleTime: 60_000,
      }),
      signal,
    );
    return Object.fromEntries(
      connections.flatMap((c) => (c.target.direction === "source" ? [[c.name, c.target.url]] : [])),
    );
  },
  credentials: async (scope: Scope, access: Access, { signal }): Promise<StorageCredential[]> => {
    const vended =
      "job" in scope
        ? await http.POST("/v1/jobs/{id}/credentials", {
            params: { path: { id: scope.job } },
            body: { access },
            signal,
          })
        : await http.POST("/v1/connections/{name}/credentials", {
            params: { path: { name: scope.connection } },
            body: { access },
            signal,
          });
    return vended.data!.storage_credentials;
  },
};
