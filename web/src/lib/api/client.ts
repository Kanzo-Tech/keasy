import { createApiClient } from "@keasy/api";
import createQueryHooks from "openapi-react-query";

import { API } from "@/lib/routes";

import { auth } from "./session";

export { ApiError } from "@keasy/api";
export type { ErrorCode, Inputs, NoBodyCode, Schemas, paths } from "@keasy/api";
export { invalidate } from "./query-client";

/**
 * The one runtime client. `paths` is the interface: every call names a spec
 * path, and a non-2xx has already thrown an `ApiError` by the time it returns.
 * Same origin: `/api/v1` is the BFF, which attaches the session's bearer token.
 */
export const http = createApiClient({ baseUrl: API, fetch: auth.fetch });

/** React Query bound to `http`; its keys are `[method, path, init]`. A read is named by its options. */
export const $api = createQueryHooks(http);

/** The workspace's connections, the sink among them: one read, whoever asks. */
export const connectionsQuery = $api.queryOptions("get", "/v1/connections");
