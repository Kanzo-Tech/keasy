import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/v1/auth", "/invite", "/_next", "/favicon"];

// Sub-route redirects: trivial section landing pages that should always
// resolve to a concrete child. Done here instead of empty page.tsx files.
const SECTION_REDIRECTS: Record<string, string> = {
  "/settings": "/settings/preferences",
  "/organization": "/organization/details",
  "/organization/compliance": "/organization/details",
};

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (PUBLIC.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const target = SECTION_REDIRECTS[pathname];
  if (target) {
    return NextResponse.redirect(new URL(target, req.url));
  }

  // Cookie name matches KEASY_SESSION_COOKIE_NAME (default "keasy.sid")
  if (!req.cookies.has("keasy.sid")) {
    return NextResponse.redirect(new URL("/v1/auth/oidc-start", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon|public).*)"],
};
