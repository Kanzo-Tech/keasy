import "server-only";

import { readFileSync } from "node:fs";

import { authSession } from "@kanzo-tech/auth/next";
import type { Session } from "@kanzo-tech/auth";
import {
  sealedCookie,
  statelessStore,
  type RelyingPartyConfig,
  type SealedCookie,
  type SessionStore,
} from "@kanzo-tech/auth/server";

/**
 * The relying party, in one place.
 *
 * This application is a Backend For Frontend: the confidential client lives
 * here, the tokens never reach the browser, and the Rust API behind it is a
 * resource server that validates a bearer token. Three files consume what is
 * bound below — `app/api/auth/[...auth]/route.ts`, `middleware.ts` and every
 * server component that calls `getSession()` — plus `app/v1`, the proxy, which
 * is the only thing here that needs a token rather than a session.
 *
 * ## Everything here is bound on first use, and that is not a style choice
 *
 * `next build` collects every route's module, and the image is built without
 * secrets — as it should be, because a build artefact that embeds a client
 * secret is one that cannot be promoted between environments. So the
 * environment is read on the first request rather than at import, and a missing
 * variable is a loud failure *then*: at boot the deployment is what is wrong,
 * and at build time nothing is.
 */

/**
 * A configuration value, from `NAME` or from the file `NAME_FILE` points at.
 *
 * The `_FILE` form is how a Swarm or Kubernetes secret arrives — mounted, not
 * exported — and it is the same contract the Rust side has always read. A
 * secret that is only ever an environment variable is one that shows up in
 * `docker inspect`.
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

/** Eight hours: a working day, and the package's own default said out loud. */
const MAX_AGE = 8 * 60 * 60;

interface Bff {
  readonly config: Omit<RelyingPartyConfig, "redirectUri">;
  readonly store: SessionStore;
  readonly cookie: SealedCookie<{ ticket: string }>;
  readonly read: () => Promise<Session | null>;
}

let bound: Bff | undefined;

function bff(): Bff {
  if (bound !== undefined) return bound;

  const issuer = required("KEASY_OIDC_ISSUER_URL");
  const secret = required("KEASY_SESSION_SECRET");

  /**
   * The session record lives in the cookie and nowhere else.
   *
   * Named rather than left to default, because `apiToken` reads records back
   * through this same instance: cookie → ticket → store → record. Nothing here
   * assumes what a ticket *is*, which is what keeps that seam honest.
   *
   * What it cannot do is invalidate a session before it expires — the Rust
   * server used to enforce one live session per user through a `user_sessions`
   * table, and that went with the rest of it. A cookie already in someone's
   * hands cannot be taken back, so `MAX_AGE` is a real security parameter here.
   * Give this a store of its own the day "sign out everywhere" is a feature.
   */
  const store = statelessStore();

  const config: Omit<RelyingPartyConfig, "redirectUri"> = {
    issuer,
    clientId: required("KEASY_OIDC_CLIENT_ID"),
    clientSecret: required("KEASY_OIDC_CLIENT_SECRET"),
    secret,
    store,
    maxAge: MAX_AGE,
    // Where *this process* reaches Keycloak, when that is not where the browser
    // does. An origin: the issuer's own path is appended to it.
    internalOrigin: process.env.KEASY_OIDC_INTERNAL_BASE_URL?.trim() || undefined,
    // A compose file on a laptop serves `http://localhost:3000/auth/realms/keasy`,
    // and without this nothing local can be configured at all.
    allowInsecureHttp: issuer.startsWith("http://"),
  };

  bound = {
    config,
    store,
    // The same cookie `relyingParty` issues. Name and lifetime must match what
    // the config above produces — they do, because both are written here.
    cookie: sealedCookie({ name: "kanzo-session", secret, maxAge: MAX_AGE }),
    read: authSession(config),
  };
  return bound;
}

/** The relying party's configuration, for the route handlers that mount it. */
export function relyingPartyConfig(): Omit<RelyingPartyConfig, "redirectUri"> {
  return bff().config;
}

/**
 * The session a server component reads. Memoised per request by the package, so
 * a layout, a breadcrumb and a menu unseal the cookie once between them.
 */
export function getSession(): Promise<Session | null> {
  return bff().read();
}

/**
 * The credential to spend at the resource server, or `null`.
 *
 * **This is the one place a token is handled outside the package**, and it is
 * the ID token rather than the access token: `SessionRecord` keeps the refresh
 * token and the ID token and discards the access token, so the ID token is what
 * the BFF actually holds. It is signed by the same realm, carries the same
 * `sub`, `exp` and `resource_access.<clientId>.roles`, and the tenant client's
 * audience mapper puts this API in its `aud`. The Rust side validates
 * signature, `iss`, `aud`, `exp` and `azp` against exactly that.
 *
 * *What would reverse it:* `SessionRecord` gaining an `accessToken`. Then this
 * reads that field instead and nothing else anywhere changes.
 */
export async function apiToken(cookie: string | null): Promise<string | null> {
  const { cookie: sealed, store } = bff();
  const carried = await sealed.read(cookie);
  if (carried === null) return null;
  return (await store.get(carried.ticket))?.idToken ?? null;
}
