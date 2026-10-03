import { createGraph, MISSING } from "../support/api";
import { openPanel, test } from "../support/fixtures";
import { expectProblem } from "../support/problem";

test("01 a graph that does not exist opens in discover as graph/not-found", async ({ page }) => {
  await page.goto(`/graphs/${MISSING}/discover`);
  await expectProblem(page, "graph/not-found", { within: 5_000 });
});

test("02 a graph that has not completed opens in discover as graph/not-completed", async ({ page }) => {
  const id = await createGraph(page, { draft: true });
  await page.goto(`/graphs/${id}/discover`);
  await expectProblem(page, "graph/not-completed", { within: 10_000 });
});

test("17 a rule the engine refuses is query/failed on its row", async ({ page, corpusGraph }) => {
  // The rule builder offers only real columns; the rule is written where the panel keeps rules.
  const rule = { id: "e2e-broken", fieldKey: "no_such_column", operator: "not_null", typeName: "Person" };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [`keasy:rules:${corpusGraph}`, JSON.stringify({ state: { rules: [rule] }, version: 0 })],
  );
  await openPanel(page, corpusGraph, "Rules");
  await expectProblem(page, "query/failed", { within: 20_000 });
});
