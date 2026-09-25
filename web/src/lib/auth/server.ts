import "server-only";

import { readFileSync } from "node:fs";

import {
  authProxy,
  authRoutes,
  authSession,
  type AuthProxyHandlers,
  type AuthRouteHandlers,
} from "@kanzo-tech/auth/next";
import type { Session } from "@kanzo-tech/auth";
import { ticketStore, type RelyingPartyConfig, type TicketAdapter } from "@kanzo-tech/auth/server";
import { redirect } from "next/navigation";
import { createClient } from "redis";

import { workspaceRole, type WorkspaceRole } from "./roles";

/**
 * The relying party, in one place.
 *
 * This application is a Backend For Frontend: the confidential client lives
 * here, the tokens never reach the browser, and the Rust API behind it is a
 * resource server that validates the access token `/api/v1` forwards. Every
 * route handler lives under `/api`: `/api/auth` is the relying party and
 * `/api/v1` the token-mediating proxy.
 *
 * Everything is bound on first use: `next build` collects every route's module
 * and the image is built without secrets, so a missing variable is a loud
 * failure on the first request rather than at build time.
 */

/**
 * A configuration value, from `NAME` or from the file `NAME_FILE` points at —
 * how a Swarm secret arrives, and the contract the Rust side reads.
 */
function required(name: string): string {
  const path = process.env[`${name}_FILE`]?.trim();
  if (path !== undefined && path !== "") {
    const contents = readFileSync(path, "utf8").trim();
    if (contents !== "") return contents;
    throw new Error(`${name}_FILE points at ${path}, which is empty`);
  }

  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(
      `${name} (or ${name}_FILE) is required — the BFF cannot sign anyone in without it`,
    );
  }
  return value;
}

/** Eight hours: a working day, and the lifetime of both the cookie and its ticket. */
const MAX_AGE = 8 * 60 * 60;

/**
 * Session records live in Valkey/Redis under the opaque ticket the cookie
 * carries: with the access token in it a record no longer fits in a cookie, and
 * a ticket is what lets a sign-out end every copy of that cookie.
 */
function redisAdapter(url: string): TicketAdapter {
  const client = createClient({ url }).on("error", (error) => {
    console.error("session store:", error);
  });
  const ready = client.connect();

  return {
    read: async (key) => (await ready).get(key),
    write: async (key, value, ttl) => {
      await (await ready).set(key, value, { expiration: { type: "EX", value: ttl } });
    },
    delete: async (key) => {
      await (await ready).del(key);
    },
  };
}

interface Bff {
  readonly routes: AuthRouteHandlers;
  readonly read: () => Promise<Session | null>;
  readonly proxy: AuthProxyHandlers;
}

let bound: Bff | undefined;

function bff(): Bff {
  if (bound !== undefined) return bound;

  const issuer = required("KEASY_OIDC_ISSUER_URL");
  const config: Omit<RelyingPartyConfig, "redirectUri"> = {
    issuer,
    clientId: required("KEASY_OIDC_CLIENT_ID"),
    clientSecret: required("KEASY_OIDC_CLIENT_SECRET"),
    secret: required("KEASY_SESSION_SECRET"),
    store: ticketStore(redisAdapter(required("KEASY_SESSION_STORE_URL")), { ttl: MAX_AGE }),
    maxAge: MAX_AGE,
    // Where *this process* reaches Keycloak, when that is not where the browser
    // does. An origin: the issuer's own path is appended to it.
    internalOrigin: process.env.KEASY_OIDC_INTERNAL_BASE_URL?.trim() || undefined,
    allowInsecureHttp: issuer.startsWith("http://"),
  };

  bound = {
    // `redirectUri` is derived from the incoming request — its origin, this
    // route's path and `/callback` — which lets one image serve every host. A
    // forged `Host` yields a `redirect_uri` Keycloak has not registered.
    routes: authRoutes(config),
    read: authSession(config),
    // The spec's paths already start with `/v1`, so the proxy strips `/api` only.
    proxy: authProxy({
      ...config,
      target: required("KEASY_API_URL").replace(/\/$/, ""),
      basePath: "/api",
    }),
  };
  return bound;
}

/** `/api/auth`: sign-in, callback, sign-out, session. */
export function authHandlers(): AuthRouteHandlers {
  return bff().routes;
}

/** The session a server component reads, memoised per request by the package. */
export function getSession(): Promise<Session | null> {
  return bff().read();
}

/**
 * A layout's guard for one plane. A session holding no role never gets here —
 * `(main)/layout.tsx` has already refused it — so what is left is the other
 * plane, which is sent `elsewhere`.
 */
export async function requireRole(role: WorkspaceRole, elsewhere: string): Promise<void> {
  if (workspaceRole(await getSession()) !== role) redirect(elsewhere);
}

/** `/api/v1`: the browser's API call, forwarded to the resource server with the access token. */
export function apiHandlers(): AuthProxyHandlers {
  return bff().proxy;
}
