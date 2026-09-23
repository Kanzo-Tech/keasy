import { describe, expect, it } from "vitest";
import type { Session } from "@kanzo-tech/auth";
import { workspaceRole } from "@/lib/roles";

/** A session holding exactly these client roles, and nothing else that matters here. */
function session(...roles: string[]): Session {
  return {
    user: { id: "u-1", email: "dev@keasy.local" } as Session["user"],
    roles,
    organizations: [],
    expiresAt: Date.now() + 60_000,
  };
}

/**
 * These four answers are the TypeScript half of one statement. The other half is
 * `role_from` in `server/src/middleware/bearer.rs`, which reads the same claim
 * and has the same four tests — and the server is the one that refuses, so a
 * disagreement here means the app draws a surface that will 403.
 */
describe("workspaceRole", () => {
  it("reads each plane from its own role", () => {
    expect(workspaceRole(session("owner"))).toBe("owner");
    expect(workspaceRole(session("member"))).toBe("member");
  });

  it("is null for a session holding no workspace role", () => {
    expect(workspaceRole(session())).toBeNull();
    expect(workspaceRole(session("uma_authorization"))).toBeNull();
    expect(workspaceRole(null)).toBeNull();
    expect(workspaceRole(undefined)).toBeNull();
  });

  // The planes are disjoint, so there is no "highest" of the two to pick.
  // Ranking them is what would draw an owner a data plane the server refuses.
  it("is null when both roles are held at once", () => {
    expect(workspaceRole(session("owner", "member"))).toBeNull();
    expect(workspaceRole(session("member", "owner"))).toBeNull();
  });
});
