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

test("17 a rules file rudof cannot read is rules/refused in the Rules panel, and nothing is saved", async ({ page, corpusGraph }) => {
  await openPanel(page, corpusGraph, "Rules");
  // Dropped as a person drops it: the server reads it with rudof and refuses it where Turtle stops.
  await page.locator('input[type="file"]').setInputFiles({
    name: "broken.ttl",
    mimeType: "text/turtle",
    buffer: Buffer.from("@prefix sh: <http://www.w3.org/ns/shacl#> .\n<#S> a sh:NodeShape ;\n  sh:path .\n"),
  });
  await expectProblem(page, "rules/refused", { within: 20_000 });
  expect((await api(page, "GET", `/v1/graphs/${corpusGraph}/rules`)).body).toBeNull();
});
