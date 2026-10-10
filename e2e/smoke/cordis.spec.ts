import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DiscoverPage } from "../support/app";
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

test("the funding rules find what the seed lacks: countries and SME status, and flag zero costs, unplaced organisations and ended participations", async ({ page, env, cordisGraph }) => {
  // Opened in the dashboard (#116's ?view), as the flights rules are: the Graph view never mounts.
  // Landing in it and clicking across left 206K nodes laying out on the CPU rudof needs, and the
  // check that takes ~4 s beside the dashboard had not ended after 23 min.
  const discover = await DiscoverPage.open(page, env, cordisGraph, { view: "dashboard" });
  const rules = await discover.rules();
  // infra/dev/examples/cordis/rules.ttl, dropped on the badge as a person drops it.
  await rules.drop("rules.ttl", readFileSync(fileURLToPath(new URL("../../infra/dev/examples/cordis/rules.ttl", import.meta.url)), "utf8"));
  // Checked when asked, over the whole corpus.
  await rules.start();
  await expect.poll(() => rules.checked(), { timeout: 240_000 }).toMatch(/^Checked over all 206,629 nodes/);

  const expectFinding = async (rule: string, message: string, severity: "Violation" | "Warning", flagged: number) => {
    const finding = await (await rules.rule(rule)).finding(message);
    expect(await finding.severity(), message).toBe(severity);
    expect(await finding.flagged(), message).toBe(flagged);
  };

  // projects.csv: 12,525 rows whose `totalCost` is 0, a warning. Nothing else: every status is one
  // CORDIS uses, every EU contribution is above 0 and every project has its call topic.
  expect(await (await rules.rule("Project")).findings()).toHaveLength(1);
  await expectFinding("Project", "The project declares a total cost of 0: its EU contribution is above it.", "Warning", 12_525);

  // organisations.csv: 5 rows with an empty `country` and one whose `country` is `DE;HU`; 1,675 with
  // no `lat`, a warning.
  const organisation = await rules.rule("Organisation");
  expect(await organisation.findings()).toHaveLength(3);
  await expectFinding("Organisation", "An organisation is registered in a country.", "Violation", 5);
  await expectFinding("Organisation", "A country is one two-letter code.", "Violation", 1);
  await expectFinding("Organisation", "The organisation has no position: it is not on the map.", "Warning", 1_675);
  expect(await organisation.state()).toBe("6 violations · 1,675 warnings");

  // participations.csv: 356 rows with an empty `sme`; 3,164 whose `ended` is true, a warning. Every
  // role is one CORDIS uses, every amount is non-negative, and every participation has one
  // organisation and one project.
  expect(await (await rules.rule("OrganisationRole")).findings()).toHaveLength(2);
  await expectFinding("OrganisationRole", "A participation says whether the organisation is an SME.", "Violation", 356);
  await expectFinding("OrganisationRole", "The organisation's participation has ended.", "Warning", 3_164);

  // Show puts the finding's organisations on the page.
  expect(await organisation.show("An organisation is registered in a country.")).toBe(5);
  await expect.poll(() => discover.counts()).toMatch(/^5 of 206\.6K nodes match/);
});
