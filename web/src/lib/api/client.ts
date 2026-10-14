import { ApiError, createApiClient } from "@keasy/api";
import createQueryHooks from "openapi-react-query";

import { deadlineFetch } from "@/lib/deadline";
import { API } from "@/lib/routes";

import { auth } from "./session";

export { ApiError, HttpError, retryable } from "@keasy/api";
export type { ErrorCode, Inputs, Schemas, paths } from "@keasy/api";
export { invalidate } from "./query-client";

/** Nothing came back from the BFF or the server behind it within `ms`. */
function serverSilent(ms: number): ApiError {
  return new ApiError(
    {
      code: "server/silent",
      title: "The server did not answer in time",
      detail: `Nothing came back for ${ms / 1000} s.`,
      data: { after: ms },
    },
    undefined,
  );
}

/**
 * The one runtime client. `paths` is the interface: every call names a spec
 * path, and a non-2xx has already thrown an `ApiError` by the time it returns.
 * Same origin: `/api/v1` is the BFF, which attaches the session's bearer token,
 * through `auth.fetch`, which renews a session a 401 ended once. Each call is
 * bounded here, renewal and retry included: the session read is `auth`'s own.
 */
export const http = createApiClient({ baseUrl: API, fetch: deadlineFetch(serverSilent, undefined, auth.fetch) });

/** React Query bound to `http`; its keys are `[method, path, init]`. A read is named by its options. */
export const $api = createQueryHooks(http);

/** The workspace's connections, the sink among them: one read, whoever asks. */
export const connectionsQuery = $api.queryOptions("get", "/v1/connections");
