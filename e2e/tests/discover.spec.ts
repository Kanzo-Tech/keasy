import { expect } from "@playwright/test";

import { api, createGraph, MISSING } from "../support/api";
import { openPanel, test } from "../support/fixtures";
import { expectProblem } from "../support/problem";

test("01 a graph that does not exist opens in discover as graph/not-found", async ({ page }) => {
  await page.goto(`/graphs/${MISSING}/discover`);
  // The suite's first visit to discover: the dev server builds the page's client chunks after load,
  // so this gets 02's budget rather than a cached page's.
  await expectProblem(page, "graph/not-found", { within: 10_000 });
});

test("02 a graph that has not completed opens in discover as graph/not-completed", async ({ page }) => {
  const id = await createGraph(page, { draft: true });
  await page.goto(`/graphs/${id}/discover`);
  await expectProblem(page, "graph/not-completed", { within: 10_000 });
});

test("17 a rule rudof refuses is rules/refused in the Rules panel", async ({ page, corpusGraph }) => {
  // SHACL-SPARQL is not SHACL Core: the SQL engine refuses the shape when it loads, never skips it.
  const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> .
<urn:uuid:e2e-refused> a sh:NodeShape ; sh:targetClass <https://example.org/Person> ;
  sh:sparql [ sh:select "SELECT $this WHERE { }" ] .`;
  expect((await api(page, "PUT", `/v1/graphs/${corpusGraph}/rules`, { shapes })).status).toBe(200);
  await openPanel(page, corpusGraph, "Rules");
  await expectProblem(page, "rules/refused", { within: 20_000 });
});
