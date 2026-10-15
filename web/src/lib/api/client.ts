import { ApiError, createApiClient } from "@keasy/api";
import createQueryHooks from "openapi-react-query";

import { deadlineFetch } from "@/lib/deadline";
import { API } from "@/lib/routes";

export { ApiError, HttpError, retryable } from "@keasy/api";
export type { ErrorCode, Inputs, Schemas, paths } from "@keasy/api";
export { invalidate } from "./query-client";

/** Nothing came back from the forwarder or the server behind it within `ms`. */
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
 * Same origin: `/api/v1` is the web's forwarder, which sends the token the edge forwarded as the
 * bearer; a request whose session ended answers 401 from the edge (`query-client.ts`). Each call is
 * bounded here.
 */
export const http = createApiClient({ baseUrl: API, fetch: deadlineFetch(serverSilent) });

/** React Query bound to `http`; its keys are `[method, path, init]`. A read is named by its options. */
export const $api = createQueryHooks(http);

/** The workspace's connections, the sink among them: one read, whoever asks. */
export const connectionsQuery = $api.queryOptions("get", "/v1/connections");
