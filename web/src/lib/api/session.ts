import "client-only";

import { bffAuth } from "@kanzo-tech/auth";

/**
 * The browser's half of the BFF, and the only one: no token, no storage — a
 * `fetch` to `/api/auth/session` and a cookie it cannot read. What it yields is
 * for drawing; the resource server behind `/api/v1` is what refuses a request.
 */
export const auth = bffAuth({ basePath: "/api/auth" });
