import { agreedCount, brush, expect, PLOT, saveDashboard, test } from "../support/smoke";

/**
 * The LDBC SNB dev graph (infra/dev/snb.fossil over `make seed`'s SF0.1): 327,588 vertices of eight
 * types. Every number below is the seed's, counted from infra/dev/seed/ldbc/, which `make seed` pins
 * by digest.
 */

/** Comments that reply to a post, each with the post it replies to: 74,256 of the 151,043 comments. */
const RELATION = "Comment>replyOfPost>Post";
const PATHS = "74,256";

// 327,588 vertices: every view of them takes longer than the shop's 20.
test.describe.configure({ timeout: 300_000 });

/** One tile of every kind and every chart mark, over a relation with a hop — a join. */
const DASHBOARD = {
  filters: [{ field: "Comment.browserUsed" }],
  tiles: [
    { id: "count", kind: "stat", title: "Replies", measure: { op: "count" } },
    { id: "length", kind: "stat", title: "Mean reply length", measure: { op: "avg", field: "Comment.length" } },
    { id: "bar", kind: "chart", span: 1, type: "bar", title: "By browser", x: "Comment.browserUsed", y: { op: "count" } },
    { id: "line", kind: "chart", span: 1, type: "line", title: "Length over time", x: "Comment.creationDate", y: { op: "avg", field: "Comment.length" } },
    { id: "area", kind: "chart", span: 1, type: "area", title: "Posts replied to over time", x: "Post.creationDate", y: { op: "count" } },
    { id: "histogram", kind: "chart", span: 1, type: "histogram", title: "By reply length", x: "Comment.length", y: { op: "count" } },
    { id: "dot", kind: "chart", span: 1, type: "dot", title: "Reply against post", x: "Post.length", y: { op: "value", field: "Comment.length" } },
    { id: "fit", kind: "chart", span: 1, type: "regression", title: "Fit of reply against post", x: "Post.length", y: { op: "value", field: "Comment.length" } },
    { id: "rows", kind: "table", span: 3, title: "Reply rows", columns: ["Comment.browserUsed", "Comment.length", "Post.length"] },
  ],
};

test("the social network opens in Graph view with every vertex", async ({ page, snbGraph }) => {
  await page.goto(`/graphs/${snbGraph}/discover`);
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^327\.6K nodes · /, { timeout: 120_000 });
});

test("the social network's dashboard over a hop draws every tile kind, and holds under a brush and a filter chip", async ({ page, snbGraph }) => {
  await saveDashboard(page, snbGraph, RELATION, DASHBOARD);
  await page.goto(`/graphs/${snbGraph}/discover`);
  // The canvas draws 327.6K nodes on a software GPU: the switch is dispatched, not clicked through it.
  await page.getByRole("radio", { name: "Dashboard" }).dispatchEvent("click");

  const relation = page.getByRole("group", { name: "Relation" });
  await relation.getByRole("combobox", { name: "Root type" }).click();
  await page.getByRole("option", { name: "Comment", exact: true }).click();
  await relation.getByRole("button", { name: "Hop" }).click();
  await page.getByRole("menuitem", { name: "replyOfPost → Post" }).click();

  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toContainText(`${PATHS} paths`, { timeout: 60_000 });

  const figure = (title: string) => page.locator('[data-slot="dashboard-figures"] > *').filter({ hasText: title });
  const card = (title: string) => page.locator('[data-slot="dashboard-tiles"] > *').filter({ hasText: title });
  await expect(figure("Replies")).toContainText("74.3K");
  for (const title of ["By browser", "Length over time", "Posts replied to over time", "By reply length", "Reply against post", "Fit of reply against post"]) {
    // Each reads a join of 74,256 paths: more than a type's table takes.
    await expect(card(title).locator(PLOT).first(), title).toBeVisible({ timeout: 60_000 });
  }
  await expect(card("By browser")).toContainText("Firefox");
  await expect(card("Reply rows")).toContainText("Comment.browserUsed");

  // A brush on reply length, past the bin of the shortest — most replies are under a hundred
  // characters: every other tile reads the paths it keeps.
  await brush(page, card("By reply length"), 0.14, 0.25);
  const kept = await agreedCount(page, { total: 74_256, noun: "paths", figure: "Replies" });
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(74_256);
  await expect(card("Fit of reply against post").locator(PLOT).first()).toBeVisible();
  const brushChip = filters.getByRole("button", { name: /^Remove .*Comment\.length/ });
  await brushChip.click();
  await expect(filters).toContainText(`${PATHS} paths`);

  // The filter chip: the 28,807 replies written in Firefox.
  await filters.getByRole("button", { name: /^Comment\.browserUsed:/ }).click();
  // Each value with its count over the whole relation.
  await page.getByRole("option", { name: "Firefox 28807", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await agreedCount(page, { total: 74_256, noun: "paths", figure: "Replies" })).toBe(28_807);
});
