import { can, type Organization, type Session } from "@kanzo-tech/auth";

import type { Schemas } from "@keasy/api";

/**
 * The roles a workspace grants, and the one place this application reads them.
 *
 * A workspace serves one Keycloak Organization (`Branding.organization`), and the roles are the
 * ones held *inside* it: `reader ⊂ editor ⊂ admin`, declared as composite roles in the realm, so
 * the token carries the expanded set and an admin holds all three. Nothing here ranks them.
 *
 * **What this decides is what to draw.** The resource server, validating the bearer token behind
 * `/v1`, is what refuses a request.
 */
export type Role = Schemas["Role"];

export const ROLE_LABEL: Record<Role, string> = { reader: "Reader", editor: "Editor", admin: "Admin" };

/** Most to least: the first held is the one a badge names. */
const BY_REACH: readonly Role[] = ["admin", "editor", "reader"];

export function holds(session: Session | null | undefined, organization: string, role: Role): boolean {
  return can(session, role, organization);
}

/** The widest role held in `organization`, for a label only — never for a decision. */
export function displayRole(session: Session | null | undefined, organization: string): Role | null {
  return BY_REACH.find((role) => holds(session, organization, role)) ?? null;
}

/** The organizations this person holds a role in: the workspaces they can switch to. */
export function switchable(session: Session | null | undefined): readonly Organization[] {
  return session?.organizations.filter((o) => o.roles.length > 0) ?? [];
}
