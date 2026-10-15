import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth/server";
import { tenantOf } from "@/lib/tenant";

/**
 * Every request the edge let through: a page on a host that addresses no organization does not
 * exist; the rest go on with the URL the browser addressed, for the session's tenant. `/api` is the
 * API forward, which answers for itself.
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
