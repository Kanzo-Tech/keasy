import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

import { DiscoverPage } from "../support/app";
import { api, createGraph, MISSING } from "../support/stack/api";
import { test } from "../support/fixtures";
import { expectProblem } from "../support/stack/problem";

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

test("17 a rules file rudof cannot read is rules/refused in the Rules panel, and nothing is saved", async ({ page, env, corpusGraph }) => {
  const rules = await (await DiscoverPage.open(page, env, corpusGraph, { panel: "rules" })).rules();
  // Dropped as a person drops it: the server reads it with rudof and refuses it where Turtle stops.
  await rules.drop("broken.ttl", "@prefix sh: <http://www.w3.org/ns/shacl#> .\n<#S> a sh:NodeShape ;\n  sh:path .\n");
  await expectProblem(page, "rules/refused", { within: 20_000 });
  expect((await api(page, "GET", `/v1/graphs/${corpusGraph}/rules`)).body).toBeNull();
});

test("the tile editor is the Dashboard view's: Graph view hides it, and its draft comes back with Dashboard", async ({ page, env, corpusGraph }) => {
  const discover = await DiscoverPage.open(page, env, corpusGraph, { view: "dashboard" });
  await discover.dashboard();
  const format = page.getByRole("complementary", { name: "Format" });
  await page.getByRole("button", { name: "Add tile" }).click();
  const title = format.getByRole("textbox", { name: "Title" });
  await title.fill("Kept across views");

  await discover.view("Graph");
  await expect(format).toBeHidden();

  await discover.view("Dashboard");
  await expect(title).toHaveValue("Kept across views");
});

test("the view and the dock's panel are the URL's: a link opens them, and pressing them writes it", async ({ page, env, corpusGraph }) => {
  const rules = page.getByRole("complementary", { name: "Rules panel" });
  const discover = await DiscoverPage.open(page, env, corpusGraph, { view: "dashboard", panel: "rules" });
  const [views, dock] = [await discover.views(), await discover.dock()];
  expect(await views.current()).toBe("Dashboard");
  expect(await dock.current()).toBe("Rules");

  // Graph keeps the panel the dock holds; the URL names only what differs from the bare page.
  await discover.view("Graph");
  await expect(page).toHaveURL(/\/discover\?panel=rules$/);
  await expect(rules).toBeVisible();

  // Pressing the panel the dock holds collapses it, and a reload opens the page as it was left.
  await dock.close();
  await expect(page).toHaveURL(/\/discover\?panel=none$/);
  await expect(rules).toBeHidden();
  await page.reload();
  // The hook is installed again on every load: the environment outlives the reload.
  expect(await (await discover.views()).current()).toBe("Graph");
  const graph = await discover.graph();
  await graph.ready();
  await expect.poll(() => graph.counts()).toMatch(/^20 nodes/);
  expect(await (await discover.dock()).current()).toBeNull();

  // Dashboard collapses the dock, as it always has: a dashboard is judged at full width.
  await discover.panel("Info");
  await discover.view("Dashboard");
  await expect(page).toHaveURL(/\/discover\?view=dashboard$/);
  expect(await (await discover.dock()).current()).toBeNull();
});

test("rules are validated over the corpus's triples: what fails, what conforms, and over the page's subset", async ({ page, env, corpusGraph }) => {
  const discover = await DiscoverPage.open(page, env, corpusGraph, { panel: "rules" });
  const rules = await discover.rules();
  // The suite's own rules over its fixtures (e2e/fixtures/vocab/shop.ttl), dropped as a person drops them.
  await rules.drop("shop.ttl", readFileSync(new URL("../fixtures/vocab/shop.ttl", import.meta.url), "utf8"));

  // Over the whole corpus: the two people outside GB and US break the Person rule; every order
  // keeps its own.
  await expect.poll(() => rules.checked(), { timeout: 30_000 }).toMatch(/^Checked over all 20 nodes/);
  const shipping = await (await rules.rule("Person")).finding("Ships only to GB and US");
  const order = await rules.rule("Order");
  await expect.poll(() => order.state()).toBe("In order");

  // Show puts the finding's vertices on the page as its clause.
  expect(await shipping.show()).toBe(2);
  await expect.poll(() => discover.counts()).toMatch(/^2 of 20 nodes match/);
  await shipping.hide();

  // What conforms is rudof's Shape Fragment, read back by its subjects: six people and every order.
  await rules.conforms();
  await expect.poll(() => discover.counts()).toMatch(/^18 of 20 nodes match/);
  await rules.conforms(false);
  await expect.poll(() => discover.counts()).toMatch(/^20 nodes/);

  // A subset picked elsewhere on the page is what the rules check: the four people in the US, all
  // of whom the Person rule admits.
  expect(await (await discover.search()).add("country:US", 4)).toBe(4);
  await expect.poll(() => discover.counts()).toMatch(/^4 of 20 nodes match/);
  const subset = await discover.rules();
  await expect.poll(() => subset.checked(), { timeout: 30_000 }).toMatch(/^Checked over the selection: 4 of 20 nodes/);
  const person = await subset.rule("Person");
  await expect.poll(() => person.state()).toBe("In order");
});
