import { fileURLToPath } from "node:url";

import { discoverUrl } from "../support/fixtures";
import { expect, test } from "../support/smoke";

/**
 * The CORDIS dev graph (infra/dev/examples/cordis/mapping.fossil over `make seed`'s subset): Horizon
 * Europe's 23,451 projects, 35,122 organisations, the 145,274 participations between them and the
 * 2,782 funding schemes the projects answer — 206,629 vertices and 316,766 edges. Every number below
 * is the seed's, counted from infra/dev/examples/cordis/data/, which `make seed` pins by digest.
 */

// 206,629 vertices: every view of them takes longer than the shop's 20.
test.describe.configure({ timeout: 300_000 });

test("the funding graph opens in Graph view: every project, organisation and participation", async ({ page, cordisGraph }) => {
  await page.goto(`/graphs/${cordisGraph}/discover`);
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^206\.6K nodes · 316\.8K edges$/, { timeout: 120_000 });
});

test("the funding rules find what the seed lacks: countries and SME status, and flag zero costs, unplaced organisations and ended participations", async ({ page, cordisGraph }) => {
  // Opened beside the dashboard (#116's ?view and ?panel), as the flights rules are: the Graph view
  // never mounts. Landing in it and clicking across left 206K nodes laying out on the CPU rudof needs,
  // and the check that takes ~4 s beside the dashboard had not ended after 23 min.
  await page.goto(discoverUrl(cordisGraph, { view: "dashboard", panel: "rules" }));
  // infra/dev/examples/cordis/rules.ttl, dropped on the panel as a person drops it.
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../infra/dev/examples/cordis/rules.ttl", import.meta.url)));
  await expect(page.getByText("Checked over all 206,629 nodes")).toBeVisible({ timeout: 240_000 });

  const rule = (name: string) => page.getByRole("region", { name, exact: true });
  const finding = (name: string, message: string) => rule(name).locator('[data-slot="diagnostic"]').filter({ hasText: message });

  // projects.csv: 12,525 rows whose `totalCost` is 0, a warning. Nothing else: every status is one
  // CORDIS uses, every EU contribution is above 0 and every project has its call topic.
  await expect(rule("Project").locator('[data-slot="diagnostic"]')).toHaveCount(1);
  const zeroCost = finding("Project", "The project declares a total cost of 0: its EU contribution is above it.");
  await expect(zeroCost).toContainText("Warning");
  await expect(zeroCost.getByRole("button", { name: "Show 12,525" })).toBeVisible();

  // organisations.csv: 5 rows with an empty `country` and one whose `country` is `DE;HU`; 1,675 with
  // no `lat`, a warning.
  await expect(rule("Organisation").locator('[data-slot="diagnostic"]')).toHaveCount(3);
  await expect(finding("Organisation", "An organisation is registered in a country.")).toContainText("Violation");
  await expect(finding("Organisation", "An organisation is registered in a country.").getByRole("button", { name: "Show 5" })).toBeVisible();
  await expect(finding("Organisation", "A country is one two-letter code.")).toContainText("Violation");
  await expect(finding("Organisation", "A country is one two-letter code.").getByRole("button", { name: "Show 1" })).toBeVisible();
  await expect(finding("Organisation", "The organisation has no position: it is not on the map.")).toContainText("Warning");
  await expect(finding("Organisation", "The organisation has no position: it is not on the map.").getByRole("button", { name: "Show 1,675" })).toBeVisible();
  await expect(rule("Organisation").getByLabel("2 violations")).toBeVisible();
  await expect(rule("Organisation").getByLabel("1 warnings")).toBeVisible();

  // participations.csv: 356 rows with an empty `sme`; 3,164 whose `ended` is true, a warning. Every
  // role is one CORDIS uses, every amount is non-negative, and every participation has one
  // organisation and one project.
  await expect(rule("OrganisationRole").locator('[data-slot="diagnostic"]')).toHaveCount(2);
  const sme = finding("OrganisationRole", "A participation says whether the organisation is an SME.");
  await expect(sme).toContainText("Violation");
  await expect(sme.getByRole("button", { name: "Show 356" })).toBeVisible();
  const ended = finding("OrganisationRole", "The organisation's participation has ended.");
  await expect(ended).toContainText("Warning");
  await expect(ended.getByRole("button", { name: "Show 3,164" })).toBeVisible();

  // Show puts the finding's organisations on the page.
  await finding("Organisation", "An organisation is registered in a country.").getByRole("button", { name: "Show 5" }).click();
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^5 of 206\.6K nodes match/);
});
