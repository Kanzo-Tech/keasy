import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";

/**
 * The session's authority on every page request: it renews the session before its access token
 * lapses, ends one the identity provider refused, and sends a navigation without a live session to
 * sign in and back to the page it asked for. `/api` is the API forward and the sign-in routes, which
 * answer for themselves.
 */
export const proxy = (request: NextRequest) => auth.proxy(request);

export const config = {
  // Skip Next internals and any static file (any path with an extension).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
