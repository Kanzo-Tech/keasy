import { authRoutes, type AuthRouteHandlers } from "@kanzo-tech/auth/next";
import { relyingPartyConfig } from "@/lib/auth";

/**
 * The whole OIDC relying party: sign-in, callback, sign-out, session.
 *
 * `redirectUri` is derived from the incoming request — the origin it arrived at,
 * this route's path, and `/callback` — which is what lets one image serve
 * `localhost:3000` and `acme.keasy.example` without being told which it is. That
 * trusts the `Host` header, and the trust is bounded: a forged host produces a
 * `redirect_uri` Keycloak has not registered, and Keycloak refuses it.
 *
 * Mounted on the first request rather than at import, because the build has no
 * client secret to give it. See `lib/auth.ts`.
 */
let mounted: AuthRouteHandlers | undefined;

function handlers(): AuthRouteHandlers {
  return (mounted ??= authRoutes(relyingPartyConfig()));
}

export const GET = (request: Request) => handlers().GET(request);
export const POST = (request: Request) => handlers().POST(request);
