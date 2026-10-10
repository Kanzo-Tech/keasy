import type { QueryFunction } from "@tanstack/react-query";

/**
 * The Ask panel's starter questions as a query: streamed, so each lands as it arrives, but every
 * write *replaces* the cache with this request's batch so far — never adds to what an earlier
 * request left — and a stream cut short leaves nothing behind.
 *
 * Not `streamedQuery`: it appends each chunk to whatever the cache holds, and a fetch cancelled when
 * the panel stops watching (the filter changed) is reverted to its *last chunk*, so the partial batch
 * stayed cached as if it were whole — `staleTime: Infinity` then never asked again for that filter.
 */
export function startersQuery<T>(streamFn: (context: { signal: AbortSignal }) => AsyncIterable<T>): QueryFunction<T[]> {
  return async ({ client, queryKey, signal }) => {
    const query = client.getQueryCache().find({ queryKey, exact: true });
    // An aborted stream contributes nothing: back to never fetched, so the next look asks again.
    // The cancel reverts the query first and aborts after, so this runs last.
    const forget = () => query?.setState({ ...query.resetState, fetchStatus: "idle" });
    signal.addEventListener("abort", forget, { once: true });
    // A refetch starts from empty, not from the batch on screen.
    if (query?.state.data !== undefined) query.setState({ ...query.resetState, fetchStatus: "fetching" });
    const batch: T[] = [];
    try {
      for await (const item of streamFn({ signal })) {
        if (signal.aborted) break;
        batch.push(item);
        client.setQueryData<T[]>(queryKey, [...batch]);
      }
    } finally {
      signal.removeEventListener("abort", forget);
      if (signal.aborted) forget();
    }
    return batch;
  };
}
