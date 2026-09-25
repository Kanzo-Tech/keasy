import { createApiClient, type paths } from "@keasy/api";
import createQueryHooks from "openapi-react-query";

import { queryClient } from "@/lib/query-client";
import { auth } from "@/lib/session";

export { ApiError } from "@keasy/api";
export type { ErrorCode, Inputs, Schemas, paths } from "@keasy/api";

/**
 * The one runtime client. `paths` is the interface: every call names a spec
 * path, and a non-2xx has already thrown an `ApiError` by the time it returns.
 * Same origin: `/api/v1` is the BFF, which attaches the session's bearer token.
 */
export const http = createApiClient({ baseUrl: "/api", fetch: auth.fetch });

/** React Query bound to `http`; its keys are `[method, path, init]`. */
export const $api = createQueryHooks(http);

type GetPath = {
  [P in keyof paths]: paths[P] extends { get: object } ? P : never;
}[keyof paths];

/** Drop every cached read under these paths, whatever its params. */
export function invalidate(...resources: GetPath[]): Promise<void> {
  return Promise.all(
    resources.map((path) => queryClient.invalidateQueries({ queryKey: ["get", path] })),
  ).then(() => undefined);
}
