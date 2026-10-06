import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";
import { tenantOf } from "@/lib/tenant";

/**
 * The session's authority on every page request: it renews the session before its access token
 * lapses, ends one the identity provider refused, and sends a navigation without a live session to
 * sign in and back to the page it asked for. `/api` is the API forward and the sign-in routes, which
 * answer for themselves — the back-channel logout among them, which Keycloak calls on an internal
 * host. A page on a host that addresses no organization does not exist.
 */
export function proxy(request: NextRequest) {
  // `Host`, not `nextUrl`: Next builds the URL from the address it listens on, not the one asked for.
  if (!request.nextUrl.pathname.startsWith("/api/") && tenantOf(request.headers.get("host")) === undefined) {
    return new NextResponse(null, { status: 404 });
  }
  return auth.proxy(request);
}

export const config = {
  // Skip Next internals and any static file (any path with an extension).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
