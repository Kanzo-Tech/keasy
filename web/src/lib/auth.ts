import "server-only";

import { readFileSync } from "node:fs";

import { authProxy, authSession, type AuthProxyHandlers } from "@kanzo-tech/auth/next";
import type { Session } from "@kanzo-tech/auth";
import { ticketStore, type RelyingPartyConfig, type TicketAdapter } from "@kanzo-tech/auth/server";
import { createClient } from "redis";

/**
 * The relying party, in one place.
 *
 * This application is a Backend For Frontend: the confidential client lives
 * here, the tokens never reach the browser, and the Rust API behind it is a
 * resource server that validates the access token `app/v1` forwards.
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

type Config = Omit<RelyingPartyConfig, "redirectUri">;

interface Bff {
  readonly config: Config;
  readonly read: () => Promise<Session | null>;
  readonly proxy: AuthProxyHandlers;
}

let bound: Bff | undefined;

function bff(): Bff {
  if (bound !== undefined) return bound;

  const issuer = required("KEASY_OIDC_ISSUER_URL");
  const config: Config = {
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
    config,
    read: authSession(config),
    proxy: authProxy({
      ...config,
      target: `${required("KEASY_API_URL").replace(/\/$/, "")}/v1`,
      basePath: "/v1",
    }),
  };
  return bound;
}

/** The relying party's configuration, for the route handlers that mount it. */
export function relyingPartyConfig(): Config {
  return bff().config;
}

/** The session a server component reads, memoised per request by the package. */
export function getSession(): Promise<Session | null> {
  return bff().read();
}

/** `/v1`: the browser's API call, forwarded to the resource server with the access token. */
export function apiProxy(): AuthProxyHandlers {
  return bff().proxy;
}
