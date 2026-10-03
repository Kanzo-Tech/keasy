import { describe, expect, it } from "vitest";
import type { Organization, Session } from "@kanzo-tech/auth";
import { schemaOf } from "@/lib/api/spec";
import { displayRole, holds, ROLE_LABEL, switchable } from "./roles";

/** A session holding these organization roles, with the expanded composites the token carries. */
function session(...organizations: Organization[]): Session {
  return {
    user: { id: "u-1", email: "dev@keasy.local" } as Session["user"],
    roles: ["admin"],
    organizations,
    expiresAt: Date.now() + 60_000,
  };
}

const acme = (...roles: string[]): Organization => ({ alias: "acme", roles });

describe("holds", () => {
  it("asks inside the organization, never the realm roles", () => {
    expect(holds(session(), "acme", "admin")).toBe(false);
    expect(holds(session(acme("reader")), "acme", "reader")).toBe(true);
    expect(holds(session(acme("reader")), "acme", "editor")).toBe(false);
    expect(holds(session({ alias: "other", roles: ["admin"] }), "acme", "reader")).toBe(false);
    expect(holds(null, "acme", "reader")).toBe(false);
  });
});

describe("displayRole", () => {
  it("names the widest role held", () => {
    expect(displayRole(session(acme("admin", "editor", "reader")), "acme")).toBe("admin");
    expect(displayRole(session(acme("editor", "reader")), "acme")).toBe("editor");
    expect(displayRole(session(acme("reader")), "acme")).toBe("reader");
  });

  it("is null without a role in this organization", () => {
    expect(displayRole(session(acme()), "acme")).toBeNull();
    expect(displayRole(session(acme("uma_authorization")), "acme")).toBeNull();
    expect(displayRole(undefined, "acme")).toBeNull();
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
