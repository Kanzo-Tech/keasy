import { createJob, MISSING } from "../support/api";
import { openPanel, test } from "../support/fixtures";
import { expectProblem } from "../support/problem";

test("01 a job that does not exist opens in discover as job/not-found", async ({ page }) => {
  await page.goto(`/jobs/${MISSING}/discover`);
  await expectProblem(page, "job/not-found", { within: 5_000 });
});

test("02 a job that has not completed opens in discover as job/not-completed", async ({ page }) => {
  const id = await createJob(page, { draft: true });
  await page.goto(`/jobs/${id}/discover`);
  await expectProblem(page, "job/not-completed", { within: 10_000 });
});

test("17 a rule the engine refuses is query/failed on its row", async ({ page, corpusJob }) => {
  // The rule builder offers only real columns; the rule is written where the panel keeps rules.
  const rule = { id: "e2e-broken", fieldKey: "no_such_column", operator: "not_null", typeName: "Person" };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`keasy:rules:${corpusJob}`, JSON.stringify({ state: { rules: [rule] }, version: 0 })],
  );
  await openPanel(page, corpusJob, "Rules");
  await expectProblem(page, "query/failed", { within: 20_000 });
});
