import { expect } from "@playwright/test";

import { DiscoverPage, saveDashboard, saveRules } from "../support/app";
import { hasExample, seedGraph } from "../support/seeds";
import { categories, leaders } from "./charts";
import { demo } from "./record";

/** The relation the dashboard reads: each participation with the organisation it is the role of. */
const RELATION = "OrganisationRole>isRoleOf>Organisation";
const MONEY = "OrganisationRole.ecContribution";

/**
 * The dashboard, saved through the API so its tiles sum money rather than count rows (the automatic
 * dashboard only counts). The column names and the relation's key are the page's: if a take fails on
 * them, save the dashboard once from the UI and read `GET /v1/graphs/{id}/dashboard`.
 */
const DASHBOARD = {
  filters: [],
  tiles: [
    { id: "money", kind: "stat", title: "Total ecContribution", measure: { op: "sum", field: MONEY } },
    { id: "rows", kind: "stat", title: "Rows", measure: { op: "count" } },
    { id: "country", kind: "chart", span: 1, type: "bar", title: `Total ${MONEY} by Organisation.country`, x: "Organisation.country", y: { op: "sum", field: MONEY } },
    { id: "kind", kind: "chart", span: 1, type: "bar", title: `Total ${MONEY} by Organisation.activityType`, x: "Organisation.activityType", y: { op: "sum", field: MONEY } },
    { id: "role", kind: "chart", span: 1, type: "bar", title: "Count by OrganisationRole.roleLabel", x: "OrganisationRole.roleLabel", y: { op: "count" } },
  ],
};

/**
 * EU research funding: who gets Horizon Europe's €62.6 billion. Coordinators hold one seat in six and
 * 43 % of the money; universities coordinate six projects in ten, Germany's and the Netherlands' first;
 * and a rule finds 12,525 projects that declare a total cost of 0. Every figure is DuckDB's over the
 * CORDIS example (STORYBOARD.md has the queries). Off camera: the example's rules and the dashboard
 * saved, the relation picked, the rules checked.
 */
demo("cordis-funding", "EU research funding over CORDIS: who gets Horizon Europe's money, and a rule over its projects", {
  skip: !hasExample("cordis") && "needs the CORDIS example (keasy#118) under infra/dev/examples/",

  async arrange({ page, env }) {
    const id = await seedGraph(page, "cordis", { name: "Demo · CORDIS Horizon Europe", reuse: true });
    await saveRules(page, id, "cordis");
    await saveDashboard(page, id, RELATION, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id, { view: "dashboard" });
    await discover.relation("OrganisationRole", [">isRoleOf>Organisation"]);
    const dashboard = await discover.dashboard();
    const rules = await discover.rules();
    await rules.check();
    // The popover is modal: left open, it hides the dashboard behind it.
    await rules.close();
    return { discover, dashboard, rules };
  },

  steps: ({ discover, dashboard, rules }) => {
    const total = async () => (await dashboard.tile("Total ecContribution")).text();
    const countries = async () => categories(await dashboard.tile(/by Organisation\.country/));
    return [
      {
        subtitle: "€62.6 billion of Horizon Europe — who gets it?",
        async check() {
          expect(await total()).toMatch(/62\.6B$/);
          expect((await countries())[0]).toBe("DE");
        },
      },
      {
        subtitle: "Coordinators: one seat in six, 43% of the money",
        action: async () => (await (await dashboard.tile(/by OrganisationRole\.roleLabel/)).chart()).pick({ y: "coordinator" }),
        async check() {
          // 23,451 of the 145,274 participations, as a figure reads it.
          await expect.poll(() => discover.figure("Rows")).toBe("23.5K");
          expect(await total()).toMatch(/26\.8/);
        },
      },
      {
        subtitle: "Universities coordinate six projects in ten",
        action: async () => (await (await dashboard.tile(/by Organisation\.activityType/)).chart()).pick({ y: "HES" }),
        async check() {
          await expect.poll(() => discover.figure("Rows")).toBe("14.1K");
          expect(await total()).toMatch(/12\.5/);
        },
        poster: true,
      },
      {
        subtitle: "Germany and the Netherlands lead them",
        // A reading: the country chart, now over university coordinators — DE €1.88B, NL €1.40B.
        check: () => expect.poll(async () => (await leaders(await dashboard.tile(/by Organisation\.country/))).slice(0, 2)).toEqual(["DE", "NL"]),
      },
      {
        subtitle: "A rule finds 12,525 projects that declare a cost of 0",
        action: async () => (await rules.rule("Project")).show(/total cost of 0/),
        check: async () => expect(await (await (await rules.rule("Project")).finding(/total cost of 0/)).flagged()).toBe(12_525),
      },
    ];
  },
});
