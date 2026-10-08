import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

import { api, createGraph, MISSING } from "../support/api";
import { openPanel, switchPanel, test } from "../support/fixtures";
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

test("rules are validated over the corpus's triples: what fails, what conforms, and over the page's subset", async ({ page, corpusGraph }) => {
  await openPanel(page, corpusGraph, "Rules");
  // The suite's own rules over its fixtures (e2e/fixtures/vocab/shop.ttl), dropped as a person drops them.
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../fixtures/vocab/shop.ttl", import.meta.url)));
  const counts = page.locator('[data-slot="graph-counts"]');
  const person = page.getByRole("region", { name: "Person" });

  // Over the whole corpus: the two people outside GB and US break the Person rule; every order
  // keeps its own.
  await expect(page.getByText("Checked over all 20 nodes")).toBeVisible({ timeout: 30_000 });
  await expect(person.getByText("Ships only to GB and US")).toBeVisible();
  await expect(page.getByRole("region", { name: "Order" }).getByText("In order")).toBeVisible();

  // Show puts the finding's vertices on the page as its clause.
  await person.getByRole("button", { name: "Show 2" }).click();
  await expect(counts).toHaveText(/^2 of 20 nodes match/);
  await person.getByRole("button", { name: "Showing 2" }).click();

  // What conforms is rudof's Shape Fragment, read back by its subjects: six people and every order.
  await page.getByRole("button", { name: "Show what conforms" }).click();
  await expect(counts).toHaveText(/^18 of 20 nodes match/);
  await page.getByRole("button", { name: "Show what conforms" }).click();
  await expect(counts).toHaveText(/^20 nodes/);

  // A subset picked elsewhere on the page is what the rules check: the four people in the US, all
  // of whom the Person rule admits.
  await switchPanel(page, "Info");
  await page.getByRole("button", { name: /Find anything in the graph/ }).click();
  await page.getByPlaceholder("Find anything in the graph…").fill("country:US");
  await page.getByRole("button", { name: /^Add 4 to the subset/ }).click();
  await expect(counts).toHaveText(/^4 of 20 nodes match/);
  await switchPanel(page, "Rules");
  await expect(page.getByText("Checked over the selection: 4 of 20 nodes")).toBeVisible({ timeout: 30_000 });
  await expect(person.getByText("In order")).toBeVisible();
});
