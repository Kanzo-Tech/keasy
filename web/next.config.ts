import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";

/**
 * The Content-Security-Policy, and an honest account of what it does not do.
 *
 * It matters more here than in most applications because this origin is a BFF:
 * the session cookie is `httpOnly`, so script cannot read it, but script running
 * here does not need to — it can call `/v1` and the proxy will attach the bearer
 * token for it. An XSS on this origin *is* API access. Keycloak is served from
 * the same origin too (`/auth/*` in the Caddyfile), which puts the login screen
 * inside the same blast radius.
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
 * The permissive parts are the product, not laziness:
 *
 *  - `cdn.jsdelivr.net` — `@uwdata/mosaic-core`'s `wasmConnector` loads DuckDB
 *    from jsDelivr's bundles, so the worker `importScripts` from there and the
 *    `.wasm` is fetched from there.
 *  - `blob:` in `worker-src` and `script-src` — that same connector builds its
 *    worker from a Blob.
 *  - `'wasm-unsafe-eval'` — compiling WebAssembly at all. Fossil's compiler and
 *    DuckDB both run in this browser; that is the architecture.
 *  - `connect-src https:` — Discovery reads Parquet by signed URL straight from
 *    the workspace's own cloud account. The hosts are the customer's, so they
 *    cannot be enumerated here; narrowing this to `'self'` would turn the whole
 *    data plane off.
 */
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "blob:",
      "https://cdn.jsdelivr.net",
    ],
    // Tailwind ships a stylesheet, but Ark UI and the theme set positions and
    // custom properties inline as they measure, which no nonce reaches.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `next/font/google` self-hosts the files it downloads at build time, so
    // there is nothing to allow at fonts.gstatic.com.
    "font-src": ["'self'", "data:"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'", "https:", "blob:", "data:"],
    "worker-src": ["'self'", "blob:"],
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
