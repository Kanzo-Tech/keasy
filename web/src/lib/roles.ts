import { can, type Session } from "@kanzo-tech/auth";

/**
 * The two roles a workspace grants, and the one place the hierarchy is stated.
 *
 * `can` has no hierarchy on purpose — that `owner` outranks `member` is a fact
 * about this product rather than about Keycloak — so this product says it here,
 * once, and both halves of the application import the same answer.
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
  if (can(session, "owner")) return "owner";
  if (can(session, "member")) return "member";
  return null;
}
