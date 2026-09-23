"use client";

import { AuthProvider as KanzoAuthProvider, bffAuth } from "@kanzo-tech/auth";

/**
 * The browser's view of who is signed in.
 *
 * `bffAuth` is the Backend-For-Frontend pattern: no PKCE, no storage, no token —
 * a `fetch` to `/api/auth/session` and a cookie it cannot read. One instance for
 * the application, built once at module scope so a re-render does not throw away
 * the session it just read.
 *
 * What comes out of it is for **drawing**. `useSession`, `Gate` and `can` hide
 * controls; the Rust resource server, validating the token behind `/v1`, is what
 * refuses a request.
 */
const auth = bffAuth({ basePath: "/api/auth" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <KanzoAuthProvider auth={auth}>{children}</KanzoAuthProvider>;
}
