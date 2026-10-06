import "server-only";

import { readFileSync } from "node:fs";

import { can } from "@kanzo-tech/auth";
import { kanzoAuth } from "@kanzo-tech/auth/next";
import { ticketStore, type TicketAdapter } from "@kanzo-tech/auth/server";
import { redirect } from "next/navigation";
import { createClient } from "redis";

import { serverOf, tenantOf } from "@/lib/tenant";
import { PROBLEM_PAGE } from "@/lib/routes";

import type { Role } from "./roles";

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
 * The G1 table's figure for connecting to Valkey. A store that is down refuses at once (no offline
 * queue); one that hangs is bounded by `ticketStore`, which ends every adapter call at 30 s.
 */
const STORE_CONNECT_MS = 5_000;

/**
 * Session records live in Valkey/Redis under the opaque ticket the cookie
 * carries: with the access token in it a record no longer fits in a cookie, and
 * a ticket is what lets a sign-out end every copy of that cookie.
 *
 * The adapter is the driver calls; `ticketStore` bounds each of them. The
 * client reconnects on its own after a drop, and while it is down a command fails
 * at once instead of queueing (no offline queue) — so a Valkey that is down makes
 * a page fail in seconds rather than hang.
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
  return {
    read: async (key) => (await ready).get(key),
    write: async (key, value, ttl) => {
      await (await ready).set(key, value, { expiration: { type: "EX", value: ttl } });
    },
    // `XX`: only a row that still exists, so a renewal never brings back a session a back-channel
    // logout ended while the renewal was in flight.
    replace: async (key, value, ttl) =>
      (await (await ready).set(key, value, { expiration: { type: "EX", value: ttl }, condition: "XX" })) === "OK",
    delete: async (key) => {
      await (await ready).del(key);
    },
    async *keys(prefix) {
      for await (const batch of (await ready).scanIterator({ MATCH: `${prefix}*` })) yield* batch;
    },
  };
}

/** The public issuer — the one the browser is sent to, and `accountUrl` links under. */
export function issuer(): string {
  return required("KEASY_OIDC_ISSUER_URL");
}

/**
 * The relying party: proxy, routes, the API forward and the session, over one configuration that
 * is read on the first request — the image is built without secrets.
 *
 * One web serves every organization, Keycloak's Organizations model: one client, the tenant read
 * from the host, and each organization's data behind its own server. The session carries every
 * membership, which is what the workspace switcher lists.
 */
export const auth = kanzoAuth(async () => ({
  issuer: issuer(),
  clientId: required("KEASY_OIDC_CLIENT_ID"),
  clientSecret: required("KEASY_OIDC_CLIENT_SECRET"),
  secret: required("KEASY_SESSION_SECRET"),
  store: ticketStore(redisAdapter(required("KEASY_SESSION_STORE_URL")), { ttl: MAX_AGE }),
  maxAge: MAX_AGE,
  // Where *this process* reaches Keycloak, when that is not where the browser does.
  internalOrigin: process.env.KEASY_OIDC_INTERNAL_BASE_URL?.trim() || undefined,
  allowInsecureHttp: issuer().startsWith("http://"),
  organization: (request) => tenantOf(request.url.hostname),
  problemPage: PROBLEM_PAGE,
  // Each organization's own server. The spec's paths already start with `/v1`, so the forward
  // strips `/api` only; a host that addresses no organization reaches none (404).
  api: { mount: "/api", target: (organization) => organization && serverOf(organization) },
}));

/**
 * A layout's guard for one role. A session holding no role here never gets this far —
 * `(main)/layout.tsx` has already refused it — so what is left is a narrower role, sent `elsewhere`.
 */
export async function requireRole(role: Role, elsewhere: string): Promise<void> {
  if (!can(await auth.session({ required: true }), role)) redirect(elsewhere);
}
