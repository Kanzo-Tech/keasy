import { describe, expect, it } from "vitest";
import type { Organization, Session } from "@kanzo-tech/auth";
import { schemaOf } from "@/lib/api/spec";
import { displayRole, ROLE_LABEL, switchable } from "./roles";

/** A session holding these organization roles, with the expanded composites the token carries. */
function session(...organizations: Organization[]): Session {
  return {
    user: { id: "u-1", email: "dev@keasy.local" } as Session["user"],
    roles: ["admin"],
    organizations,
    organization: "acme",
    expiresAt: Date.now() + 60_000,
  };
}

const acme = (...roles: string[]): Organization => ({ alias: "acme", roles });

describe("displayRole", () => {
  it("names the widest role held in the current workspace", () => {
    expect(displayRole(session(acme("admin", "editor", "reader")))).toBe("admin");
    expect(displayRole(session(acme("editor", "reader")))).toBe("editor");
    expect(displayRole(session(acme("reader")))).toBe("reader");
  });

  it("is null without a role in this workspace, whatever the realm or another organization grants", () => {
    expect(displayRole(session(acme()))).toBeNull();
    expect(displayRole(session(acme("uma_authorization")))).toBeNull();
    expect(displayRole(session({ alias: "other", roles: ["admin"] }))).toBeNull();
    expect(displayRole(undefined)).toBeNull();
  });
});

describe("switchable", () => {
  it("lists the organizations holding a role", () => {
    const other = { alias: "other", roles: [] };
    expect(switchable(session(acme("reader"), other)).map((o) => o.alias)).toEqual(["acme"]);
    expect(switchable(null)).toEqual([]);
  });
});

describe("ROLE_LABEL", () => {
  it("labels exactly the roles the contract publishes", () => {
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...(schemaOf("Role").enum ?? [])].sort());
  });
});
