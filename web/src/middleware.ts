import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/v1/auth", "/invite", "/_next", "/favicon"];

export function middleware(req: NextRequest) {
  if (PUBLIC.some((p) => req.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next();
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
