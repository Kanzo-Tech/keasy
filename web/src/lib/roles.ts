import { can, type Session } from "@kanzo-tech/auth";

/**
 * The two roles a workspace grants, and the one place this half of the
 * application reads them.
 *
 * They are **disjoint planes, not a hierarchy**. An owner administers people,
 * identity and the catalog and has no data plane; a member runs jobs, holds the
 * connections and opens Discovery and administers nothing. Neither contains the
 * other, so there is no ranking here to state — only which of the two a session
 * holds, and `null` when it holds neither.
 *
 * Holding *both* is also `null`: two disjoint planes at once is a provisioning
 * error (`var.tenants` refuses an email listed in `owners` and in `members`),
 * and guessing which one was meant is how a surface gets drawn that the resource
 * server will refuse. `server/src/middleware/bearer.rs` reads the same claim and
 * reaches the same three answers — that is the agreement between the halves.
 *
 * They come from `resource_access.<clientId>.roles`, scoped to this workspace's
 * client, which is why there is no `organization` argument: a workspace is an
 * instance, not a Keycloak Organization, and `session.organizations` is `[]`.
 *
 * **What this decides is what to draw.** The Rust resource server, validating
 * the bearer token behind `/v1`, is what refuses a request.
 */
export type WorkspaceRole = "owner" | "member";

export function workspaceRole(session: Session | null | undefined): WorkspaceRole | null {
  const owner = can(session, "owner");
  const member = can(session, "member");
  if (owner && member) return null;
  if (owner) return "owner";
  if (member) return "member";
  return null;
}
