import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

/**
 * The Content-Security-Policy, and an honest account of what it does not do.
 *
 * It matters more here than in most applications because this origin is a BFF:
 * the session cookie is `httpOnly`, so script cannot read it, but script running
 * here does not need to — it can call `/api/v1` and the proxy will attach the bearer
 * token for it. An XSS on this origin *is* API access. Keycloak has its own
 * origin, in dev as in prod, so the login screen is outside that blast radius.
 *
 * **`script-src` carries `'unsafe-inline'`, and that is a real hole.** Next's App
 * Router emits the RSC payload and its bootstrap as inline `<script>` tags;
 * allowing them by nonce instead means generating one per request in middleware
 * and threading it through, and this application's middleware is
 * `@kanzo-tech/auth/next`'s, not its own. That is the fix, it belongs with the
 * package, and it is not worth faking here. What the policy still buys with the
 * hole in it: no script from a foreign origin, no `eval`, no plugins, no
 * `<base>` rewrite, no form posting somewhere else, and no framing at all.
 *
 * No script, worker or `.wasm` comes from another origin: DuckDB, its httpfs
 * extension and fossil's compiler are this app's own assets.
 *
 * The permissive parts are the product, not laziness:
 *
 *  - `'wasm-unsafe-eval'` — compiling WebAssembly at all. Fossil's compiler and
 *    DuckDB both run in this browser; that is the architecture.
 *  - `connect-src https:` — the browser reads and writes the workspace's own
 *    cloud account with a credential keasy vends for one prefix. The hosts are
 *    the customer's, and this policy is fixed when the image is built, so they
 *    cannot be enumerated here; narrowing it means a policy rendered per request
 *    from the workspace's credentials, which is the nonce work above.
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
    // Tailwind ships a stylesheet, but Ark UI and the theme set positions and
    // custom properties inline as they measure, which no nonce reaches.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `next/font/google` self-hosts the files it downloads at build time, so
    // there is nothing to allow at fonts.gstatic.com.
    "font-src": ["'self'", "data:"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'", "https:", "blob:", "data:"],
    "worker-src": ["'self'"],
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  if (dev) {
    // The dev server compiles with `eval` and talks to itself over a websocket.
    // Neither is in the production bundle, and neither is allowed there.
    directives["script-src"].push("'unsafe-eval'");
    directives["connect-src"].push("ws:", "http:");
  }

  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  output: "standalone",
  // The workspace contract package ships TypeScript source.
  transpilePackages: ["@keasy/api"],
  experimental: {
    authInterrupts: true,
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ],
};

export default nextConfig;
