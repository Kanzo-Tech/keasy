import "server-only";

import { can } from "@kanzo-tech/auth";
import { kanzoAuth } from "@kanzo-tech/auth/next";
import { redirect } from "next/navigation";

import { serverOf, tenantOf } from "@/lib/tenant";
import { PROBLEM_PAGE } from "@/lib/routes";

import type { Role } from "./roles";

/**
 * The person, read from the access token the platform's edge forwards.
 *
 * The relying party is `auth-proxy` (oauth2-proxy, kanzo-ui's `services/auth`) in front of this
 * application: it signs the person in, keeps the session, renews it and signs out under `/api/auth`.
 * The web holds no secret and no session; it verifies the forwarded token on every read and
 * forwards it, as it came, to the organization's server, which verifies it again. Every route
 * handler lives under `/api`.
 *
 * Bound on first use: `next build` collects every route's module and the image is built without
 * configuration, so a missing variable is a loud failure on the first request rather than at build
 * time.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

/** The public issuer — the one every token names, and `accountUrl` links under. */
export function issuer(): string {
  return required("KEASY_OIDC_ISSUER_URL");
}

/**
 * One web serves every organization, Keycloak's Organizations model: one client, the tenant read
 * from the host, and each organization's data behind its own server. The token carries every
 * membership, which is what the workspace switcher lists; the forwarder refuses a host whose
 * organization the token does not name (`organization/denied`).
 */
/**
 * The Content-Security-Policy `auth.proxy` sends with a nonce drawn per request: `script-src` is
 * `'nonce-…' 'strict-dynamic'` and what is listed here, so a script runs only when this response
 * named it or one it named loaded it — Next's own inline scripts and the theme script carry the
 * nonce (`x-nonce`, read in the root layout), and every page renders per request.
 *
 * It matters because the session is this origin's: script running here can call `/api` and the
 * forwarder attaches the token for it. An XSS on this origin *is* API access.
 *
 * - `'wasm-unsafe-eval'`: fossil's compiler and DuckDB compile WebAssembly in this browser.
 * - `worker-src 'self'`: DuckDB's, fossil's run and the model's workers are this app's own assets.
 * - `style-src 'unsafe-inline'`: Ark UI and the theme set positions and custom properties in style
 *   attributes as they measure, which no nonce reaches, and the operator's brand stylesheet is inline.
 * - `connect-src https:`: the browser reads and writes the workspace's own cloud account with a
 *   credential keasy vends for one prefix, on the customer's hosts; the model's weights come from
 *   huggingface.co and its library from raw.githubusercontent.com, fetched, never run.
 * - Development compiles with `eval` and talks to itself over a websocket; production allows neither.
 */
function contentSecurityPolicy(): Record<string, string[]> {
  const dev = process.env.NODE_ENV === "development";
  return {
    "default-src": ["'self'"],
    "script-src": ["'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // `next/font/google` self-hosts the files it downloads at build time.
    "font-src": ["'self'", "data:"],
    "img-src": ["'self'", "data:", "blob:"],
    "connect-src": ["'self'", "https:", "blob:", "data:", ...(dev ? ["ws:", "http:"] : [])],
    "worker-src": ["'self'"],
    "frame-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
}

export const auth = kanzoAuth(() => ({
  issuer: issuer(),
  clientId: required("KEASY_OIDC_CLIENT_ID"),
  // Where *this process* reaches the realm's keys, when that is not where the browser does.
  jwks: process.env.KEASY_OIDC_JWKS_URL?.trim() || undefined,
  organization: (request) => tenantOf(request.url.hostname),
  problemPage: PROBLEM_PAGE,
  csp: contentSecurityPolicy(),
  // Each organization's own server. The spec's paths already start with `/v1`, so the forward
  // strips `/api` only; a host that addresses no organization reaches none (404).
  apis: {
    "/api": { target: (organization) => organization && serverOf(organization) },
  },
}));

/**
 * A layout's guard for one role. A session holding no role here never gets this far —
 * `(main)/layout.tsx` has already refused it — so what is left is a narrower role, sent `elsewhere`.
 */
export async function requireRole(role: Role, elsewhere: string): Promise<void> {
  if (!can(await auth.session({ required: true }), role)) redirect(elsewhere);
}
