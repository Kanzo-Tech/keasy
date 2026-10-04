import "client-only";

import { type Access, type Host, type Scope, type StorageCredential, until } from "@fossil-lang/types";

import { http } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";

/**
 * keasy as fossil's `Host` — the editor's, a graph run's and a corpus's alike.
 * Fossil decides what a program reads and expands every `@name/…` into a
 * locator; keasy hands over the source connections' prefixes and, for a scope,
 * a credential scoped to its prefix for an hour. Fossil reaches the store with
 * it and renews it before it expires; keasy never signs a URL.
 *
 * The editor asks for the map on every check, so it reads the connection list
 * through the query cache under `/v1/connections`: `invalidate("/v1/connections")`
 * after adding or deleting one drops it.
 */
/**
 * How long the connection map answers every check before it is asked again: the editor checks on
 * every pause in typing, and a connection added in another tab appears within a minute. This tab's
 * own `invalidate` drops it at once.
 */
const CONNECTIONS_FRESH_MS = 60_000;

export const host: Host = {
  // `signal` is fossil's: the caller's Stop, or the 30 s a host has to answer. Passing it to the
  // request stops the request too, rather than leaving it to finish unread.
  connections: async ({ signal }) => {
    const connections = await until(
      queryClient.fetchQuery({
        queryKey: ["get", "/v1/connections", {}],
        queryFn: async ({ signal: query }) => (await http.GET("/v1/connections", { signal: query })).data ?? [],
        staleTime: CONNECTIONS_FRESH_MS,
      }),
      signal,
    );
    return Object.fromEntries(
      connections.flatMap((c) => (c.target.direction === "source" ? [[c.name, c.target.url]] : [])),
    );
  },
  // fossil's scope and access are the request, verbatim: one door, whatever is asked.
  credentials: async (scope: Scope, access: Access, { signal }): Promise<StorageCredential[]> =>
    (await http.POST("/v1/storage-credentials", { body: { scope, access }, signal })).data!.storage_credentials,
};
