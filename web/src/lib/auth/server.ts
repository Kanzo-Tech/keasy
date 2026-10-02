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

import { race } from "@/lib/deadline";

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

/** Where a failed sign-in, callback or sign-out lands, with `?code=`; `proxy.ts` keeps it public. */
export const PROBLEM_PAGE = "/auth/error";

/** Eight hours: a working day, and the lifetime of both the cookie and its ticket. */
const MAX_AGE = 8 * 60 * 60;

/**
 * The G1 table's figures for Valkey: 5 s to connect, 30 s to answer a command. A store that is
 * down refuses at once (no offline queue), so the command figure only bounds one that hangs.
 */
const STORE_CONNECT_MS = 5_000;
const STORE_COMMAND_MS = 30_000;

/**
 * Session records live in Valkey/Redis under the opaque ticket the cookie
 * carries: with the access token in it a record no longer fits in a cookie, and
 * a ticket is what lets a sign-out end every copy of that cookie.
 *
 * Every wait on it is bounded. The client reconnects on its own after a drop;
 * while it is down, a command fails at once instead of queueing (no offline
 * queue), and the first connection is raced like any command — so a Valkey that
 * is down makes a page fail in seconds rather than hang.
 */
function redisAdapter(url: string): TicketAdapter {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: STORE_CONNECT_MS,
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 5_000),
    },
  }).on("error", (error) => {
    console.error("session store:", error);
  });
  // Started once; it settles when the store first answers, and the client's own reconnects keep it
  // answering. Not a memoized rejection: with a reconnect strategy it never rejects.
  const ready = client.connect();
  // A store that throws is the package's `session/unavailable`, with this as its cause.
  const bounded = <T>(work: (c: typeof client) => Promise<T>) =>
    race(
      ready.then((c) => work(c)),
      STORE_COMMAND_MS,
      () => new Error(`The session store did not answer within ${STORE_COMMAND_MS / 1000} s`),
    );

  return {
    read: (key) => bounded((c) => c.get(key)),
    write: async (key, value, ttl) => {
      await bounded((c) => c.set(key, value, { expiration: { type: "EX", value: ttl } }));
    },
    delete: async (key) => {
      await bounded((c) => c.del(key));
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
    routes: authRoutes({ ...config, problemPage: PROBLEM_PAGE }),
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
