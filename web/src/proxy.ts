import { authMiddleware } from "@kanzo-tech/auth/next";

import { API, PROBLEM_PAGE } from "@/lib/routes";

/**
 * Sends an anonymous browser to the sign-in route, and nothing more.
 *
 * It checks the cookie's **presence**; it never opens it. A redirect is not an
 * authorization — the page behind this reads the session itself, and the Rust
 * resource server behind *that* validates the token it was sent. A forged cookie
 * gets somebody as far as a page that will find no session and say so.
 *
 * `/api/v1` is exempt because it is the API proxy, not a page: an expired
 * session there must come back as the 401 the API client knows how to route on,
 * not as a 302 to a sign-in screen it would try to parse as JSON. `/api/auth`
 * is exempt by the package itself, and so is `/auth/error`, the problem page a
 * failed sign-in lands on — the same path `authRoutes` is given, or a failed
 * sign-in loops back into signing in.
 */
export const proxy = authMiddleware({ public: [`${API}/v1`], problemPage: PROBLEM_PAGE });

export const config = {
  // Skip Next internals and any static file (any path with an extension).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
