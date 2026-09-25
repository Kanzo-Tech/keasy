import type { SourceHost } from "@fossil-lang/types";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

/**
 * keasy as fossil's `SourceHost` — the editor's and a job run's alike. Fossil
 * decides what a program reads and expands every `@name/…` into a locator; keasy
 * only hands over the connection map and signs locators with the credentials of
 * the connection each one lies under.
 *
 * The editor asks for the map on every check, so it is a query: cached with the
 * other connection queries and dropped when one is added or deleted.
 */
export const sourceHost: SourceHost = {
  connections: () =>
    queryClient.fetchQuery({
      queryKey: queryKeys.connections.refs,
      queryFn: api.connections.refs,
      staleTime: 60_000,
    }),
  sign: api.connections.signLocators,
};
