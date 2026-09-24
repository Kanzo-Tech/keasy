import { authMiddleware } from "@kanzo-tech/auth/next";

/**
 * Sends an anonymous browser to the sign-in route, and nothing more.
 *
 * It checks the cookie's **presence**; it never opens it. A redirect is not an
 * authorization — the page behind this reads the session itself, and the Rust
 * resource server behind *that* validates the token it was sent. A forged cookie
 * gets somebody as far as a page that will find no session and say so.
 *
 * `/v1` is exempt because it is the API proxy, not a page: an expired session
 * there must come back as the 401 the API client knows how to route on, not as a
 * 302 to a sign-in screen it would try to parse as JSON.
 */
export const proxy = authMiddleware({ public: ["/v1", "/healthz"] });

export const config = {
  // Skip Next internals and any static file (paths with an extension, e.g.
  // /fossil/fossil_wasm_bg.wasm). The previous `public` token matched a literal
  // `/public` prefix — which Next never serves — so public-folder assets leaked
  // into auth and 307'd. Exempting all extensioned paths fixes the whole class.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
