import { createApiClient } from "@keasy/api";

export { ApiError } from "@keasy/api";
export type { Schemas, components, paths } from "@keasy/api";

// Same origin: the BFF forwards `/v1` with the session's bearer token.
const client = createApiClient({ baseUrl: "/" });

export default client;

/** The body of a successful call; a failed one already threw an `ApiError`. */
export function unwrap<T>(result: { data?: T }): T {
  return result.data as T;
}
