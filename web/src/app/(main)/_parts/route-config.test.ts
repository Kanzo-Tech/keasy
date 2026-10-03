import { describe, expect, it } from "vitest";
import { generateBreadcrumbs, getSidebarRoutes } from "./route-config";

describe("generateBreadcrumbs", () => {
  it("names a job's crumb from the job, not from its id", () => {
    const crumbs = generateBreadcrumbs("/jobs/0b5d6c1e-1111-4222-8333-444455556666/discover");
    expect(crumbs.map((c) => c.name)).toEqual(["Dashboard", "Jobs", "Job", "Discover"]);
    expect(crumbs[2].label).toEqual({ kind: "job", id: "0b5d6c1e-1111-4222-8333-444455556666" });
  });

  it("lets a static route win over a dynamic one", () => {
    const crumbs = generateBreadcrumbs("/jobs/new");
    expect(crumbs.at(-1)).toMatchObject({ name: "New Job", path: "/jobs/new" });
    expect(crumbs.at(-1)?.label).toBeUndefined();
  });
});

describe("getSidebarRoutes", () => {
  it("draws the same sidebar for every role", () => {
    expect(getSidebarRoutes().map((r) => r.path)).toEqual(["/", "/datasets", "/jobs", "/connections"]);
  });

  it("names the admin's settings", () => {
    expect(generateBreadcrumbs("/settings/storage").at(-1)?.name).toBe("Workspace storage");
    expect(generateBreadcrumbs("/settings/members").at(-1)?.name).toBe("Members");
  });
});
