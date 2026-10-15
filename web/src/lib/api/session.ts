import "client-only";

import { bffAuth } from "@kanzo-tech/auth";

/**
 * The browser's half of the BFF, and the only one: no token, no storage — a
 * `fetch` to `/api/auth/session` and a cookie it cannot read. What it yields is
 * for drawing; the resource server behind `/api/v1` is what refuses a request.
 *
 * It bounds its own session read and renewal; an API call is bounded by the
 * client that makes it (`./client`).
 */
export const auth = bffAuth({ basePath: "/api/auth" });
