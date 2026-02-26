import { NextRequest, NextResponse } from "next/server";

// Routes where unauthenticated users are allowed; authenticated users are
// redirected to / (e.g. login, register — no point re-logging in).
const AUTH_REDIRECT_PATHS = ["/login", "/register"];

// Routes that are always accessible regardless of auth state (e.g. invite
// registration — both guests and logged-in users need to reach this page).
const ALWAYS_PUBLIC_PATHS = ["/invite"];

/** Returns true if `pathname` exactly matches or is a sub-path of any entry. */
function matchesPath(paths: string[], pathname: string): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("keasy.sid");

  // 1. Always-public paths bypass all auth checks.
  if (matchesPath(ALWAYS_PUBLIC_PATHS, pathname)) {
    return NextResponse.next();
  }

  // 2. Auth-redirect paths (login / register):
  //    - Authenticated users don't need to see these → redirect to /.
  //    - Unauthenticated users may proceed.
  if (matchesPath(AUTH_REDIRECT_PATHS, pathname)) {
    if (hasSession) {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      return NextResponse.redirect(homeUrl);
    }
    return NextResponse.next();
  }

  // 3. Protected paths — require a session.
  if (!hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // Preserve the original path so the login page can redirect back after auth.
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.png$).*)"],
};
