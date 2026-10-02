import "client-only";

import { ApiError } from "@keasy/api";
import { bffAuth } from "@kanzo-tech/auth";

import { deadlineFetch } from "@/lib/deadline";

/** Nothing came back from the BFF or the server behind it within `ms`. */
export function serverSilent(ms: number): ApiError {
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
 * The browser's half of the BFF, and the only one: no token, no storage — a
 * `fetch` to `/api/auth/session` and a cookie it cannot read. What it yields is
 * for drawing; the resource server behind `/api/v1` is what refuses a request.
 *
 * Its `fetch` is the one every API call, the session read and the renewal go
 * through, so it is where the deadline sits.
 */
export const auth = bffAuth({
  basePath: "/api/auth",
  fetch: deadlineFetch(serverSilent),
});
