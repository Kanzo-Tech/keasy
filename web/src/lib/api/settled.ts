/**
 * A suspense query's data, or its error thrown to the nearest `Boundary`. `useSuspenseQuery`
 * throws only a failure with no data yet; a poll or refetch that fails later would leave the old
 * data on screen as if current, so it is thrown here too.
 */
export function settled<T>(query: { data: T; error: unknown }): T {
  if (query.error) throw query.error;
  return query.data;
}
