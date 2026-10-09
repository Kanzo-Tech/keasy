import { DiscoverPage, saveDashboard } from "../support/app";
import { agreedCount, expect, test } from "../support/smoke";

/**
 * The LDBC SNB dev graph (infra/dev/examples/snb/mapping.fossil over `make seed`'s SF0.1): 327,588
 * vertices of eight types. Every number below is the seed's, counted from infra/dev/examples/snb/data/,
 * which `make seed` pins by digest.
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

test("the social network opens in Graph view with every vertex", async ({ page, env, snbGraph }) => {
  const discover = await DiscoverPage.open(page, env, snbGraph);
  // 327.6K nodes on a software GPU: the counts are read off the footer, not after the canvas has drawn.
  await expect.poll(() => discover.counts(), { timeout: 120_000 }).toMatch(/^327\.6K nodes · /);
});

test("the social network's dashboard over a hop draws every tile kind, and holds under a brush and a filter chip", async ({ page, env, snbGraph }) => {
  await saveDashboard(page, snbGraph, RELATION, DASHBOARD);
  // Opened on the dashboard: the canvas never draws 327.6K nodes on a software GPU first.
  const discover = await DiscoverPage.open(page, env, snbGraph, { view: "dashboard" });
  await discover.relation("Comment", ["replyOfPost → Post"]);
  const bar = await discover.filters();
  await expect.poll(() => bar.readout(), { timeout: 60_000 }).toMatch(new RegExp(`^${PATHS} paths`));

  // Each tile reads a join of 74,256 paths: more than a type's table takes (the smoke's harnesses wait 60 s).
  const dashboard = await discover.dashboard();
  expect(await (await dashboard.tile("Replies")).text()).toContain("74.3K");
  for (const title of ["By browser", "Length over time", "Posts replied to over time", "By reply length", "Reply against post", "Fit of reply against post"]) {
    await (await (await dashboard.tile(title)).chart()).settled();
  }
  expect(await (await dashboard.tile("By browser")).text()).toContain("Firefox");
  expect(await (await dashboard.tile("Reply rows")).text()).toContain("Comment.browserUsed");

  // A brush on reply length, from 100 to 300 characters — past the bin of the shortest, as most
  // replies are under a hundred: every other tile reads the paths it keeps.
  await (await (await dashboard.tile("By reply length")).chart()).brush({ x: [100, 300] });
  const kept = await agreedCount(discover, { total: 74_256, noun: "paths", figure: "Replies" });
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(74_256);
  await (await (await dashboard.tile("Fit of reply against post")).chart()).settled();
  await bar.remove("Comment.length");
  await expect.poll(() => bar.readout()).toMatch(new RegExp(`^${PATHS} paths`));

  // The filter chip: the 28,807 replies written in Firefox. The control's value list is the
  // library's and has no harness method yet, so it is driven by its roles.
  await bar.open("Comment.browserUsed");
  // Each value with its count over the whole relation.
  await page.getByRole("option", { name: "Firefox 28807", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await agreedCount(discover, { total: 74_256, noun: "paths", figure: "Replies" })).toBe(28_807);
});
