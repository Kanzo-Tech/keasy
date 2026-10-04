import { describe, expect, it } from "vitest";
import { generateBreadcrumbs, getSidebarRoutes } from "./route-config";

describe("generateBreadcrumbs", () => {
  it("names a graph's crumb from the graph, not from its id", () => {
    const crumbs = generateBreadcrumbs("/graphs/0b5d6c1e-1111-4222-8333-444455556666/discover");
    expect(crumbs.map((c) => c.name)).toEqual(["Dashboard", "Graphs", "Graph", "Explore"]);
    expect(crumbs[2].label).toEqual({ kind: "graph", id: "0b5d6c1e-1111-4222-8333-444455556666" });
  });

  it("lets a static route win over a dynamic one", () => {
    const crumbs = generateBreadcrumbs("/graphs/new");
    expect(crumbs.at(-1)).toMatchObject({ name: "New graph", path: "/graphs/new" });
    expect(crumbs.at(-1)?.label).toBeUndefined();
  });

  it("says the studio opened on a draft edits that graph's recipe", () => {
    const crumbs = generateBreadcrumbs("/graphs/new", new URLSearchParams("draft=abc"));
    expect(crumbs.map((c) => c.name)).toEqual(["Dashboard", "Graphs", "Graph", "Edit recipe"]);
    expect(crumbs[2]).toMatchObject({ path: "/graphs/abc", label: { kind: "graph", id: "abc" } });
  });
});

describe("getSidebarRoutes", () => {
  it("draws the same sidebar for every role", () => {
    expect(getSidebarRoutes().map((r) => r.path)).toEqual(["/", "/graphs", "/connections"]);
  });

  it("names the admin's settings", () => {
    expect(generateBreadcrumbs("/settings/storage").at(-1)?.name).toBe("Workspace storage");
    expect(generateBreadcrumbs("/settings/members").at(-1)?.name).toBe("Members");
  });
});
