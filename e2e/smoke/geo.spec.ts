import { DiscoverPage, saveDashboard } from "../support/app";
import { rules } from "../support/seeds";
import { agreedCount, counted, expect, figured, test, unfiltered } from "../support/smoke";

/**
 * The OpenFlights dev graph (infra/dev/examples/openflights/mapping.fossil over `make seed`'s subset):
 * 3,218 airports and the 36,906 direct routes between them. Every number below is the seed's, counted
 * from infra/dev/examples/openflights/data/airports.csv, which `make seed` pins by digest.
 */

const AIRPORTS = 3218;
/** The `count` figure with no filter on the page: every airport, none of them kept out. */
const UNFILTERED = figured(AIRPORTS);

// The suite's first visits to the views compile them in the dev server, and the seed is 160 times
// the shop.
test.describe.configure({ timeout: 300_000 });

/** One tile of every kind and every chart mark, over Airport — the relation a type alone is. */
const DASHBOARD = {
  filters: [{ field: "Airport.country" }],
  tiles: [
    { id: "count", kind: "stat", title: "Airports", measure: { op: "count" } },
    { id: "altitude", kind: "stat", title: "Mean altitude", measure: { op: "avg", field: "Airport.altitude" } },
    { id: "bar", kind: "chart", span: 1, type: "bar", title: "By country", x: "Airport.country", y: { op: "count" } },
    { id: "line", kind: "chart", span: 1, type: "line", title: "Altitude along latitude", x: "Airport.lat", y: { op: "avg", field: "Airport.altitude" } },
    { id: "area", kind: "chart", span: 1, type: "area", title: "Along longitude", x: "Airport.lon", y: { op: "count" } },
    { id: "histogram", kind: "chart", span: 1, type: "histogram", title: "By altitude", x: "Airport.altitude", y: { op: "count" } },
    { id: "dot", kind: "chart", span: 1, type: "dot", title: "Positions", x: "Airport.lon", y: { op: "value", field: "Airport.lat" } },
    // The fit is what Mosaic pre-aggregates under another tile's brush: kanzo-ui 0.32.0 failed it
    // there with `Binder Error … "t0"`, then `preagg_… does not exist` on every brush after.
    { id: "fit", kind: "chart", span: 1, type: "regression", title: "Altitude against latitude", x: "Airport.lat", y: { op: "value", field: "Airport.altitude" } },
    { id: "rows", kind: "table", span: 3, title: "Airport rows", columns: ["Airport.name", "Airport.iataCode", "Airport.country"] },
  ],
};

test("the flights graph opens in Graph view: every airport, and the routes between them", async ({ page, env, geoGraph }) => {
  const graph = await (await DiscoverPage.open(page, env, geoGraph)).graph();
  await graph.ready();
  expect(await graph.counts()).toMatch(/^3\.2K nodes · 36\.9K edges$/);
});

test("the flights dashboard draws every tile kind, and holds under a brush and a filter chip", async ({ page, env, geoGraph }) => {
  await saveDashboard(page, geoGraph, "Airport", DASHBOARD);
  const discover = await DiscoverPage.open(page, env, geoGraph, { view: "dashboard" });
  const dashboard = await discover.dashboard();
  const bar = await discover.filters();
  await expect.poll(() => unfiltered(discover, "Airports")).toBe(UNFILTERED);

  // What the editor offers is what this dashboard has one of: a kind or a mark added to kanzo-ui's
  // dashboard fails here until the smoke draws it too.
  await page.getByRole("button", { name: "Add tile" }).click();
  const format = page.getByRole("complementary", { name: "Format" });
  const offered = async (group: string) =>
    [...(await format.getByRole("radiogroup", { name: group }).ariaSnapshot()).matchAll(/radio "([^"]+)"/g)].map((m) => m[1]);
  expect(await offered("Kind")).toEqual(["Figure", "Chart", "Table"]);
  expect(await offered("Mark")).toEqual(["Bar", "Line", "Area", "Histogram", "Scatter", "Fit"]);
  await format.getByRole("button", { name: "Cancel" }).click();

  expect(await (await dashboard.tile("Airports")).text()).toContain("3,218");
  for (const title of ["By country", "Altitude along latitude", "Along longitude", "By altitude", "Positions", "Altitude against latitude"]) {
    await (await (await dashboard.tile(title)).chart()).settled();
  }
  expect(await (await dashboard.tile("By country")).text()).toContain("United States");
  expect(await (await dashboard.tile("Airport rows")).text()).toContain("Airport.iataCode");

  // A brush on the altitude histogram, from 4,000 to 8,000 ft: every other tile reads the airports it
  // keeps, the fit pre-aggregated, and the bar names it as a chip.
  await (await (await dashboard.tile("By altitude")).chart()).brush({ x: [4000, 8000] });
  const kept = counted(await agreedCount(discover, { figure: "Airports" }));
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(AIRPORTS);
  await (await (await dashboard.tile("Altitude against latitude")).chart()).settled();
  // A clause chip reads its source, then its field and range: *Airport Airport.altitude 3976.6 – 7990.0*.
  expect((await bar.chips()).some((chip) => chip.startsWith("Airport Airport.altitude "))).toBe(true);
  await bar.remove("Airport Airport.altitude");
  await expect.poll(() => unfiltered(discover, "Airports")).toBe(UNFILTERED);

  // The dashboard's filter chip: the 40 airports in Spain. The control's value list is the library's
  // and has no harness method yet, so it is driven by its roles.
  await bar.open("Airport.country");
  await page.getByRole("textbox", { name: "Filter values" }).fill("Spain");
  // Each value with its count over the whole relation.
  await page.getByRole("option", { name: "Spain 40", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await agreedCount(discover, { figure: "Airports" })).toBe(figured(40));
  // The table pages through the 40, every one of them in Spain.
  const table = await dashboard.tile("Airport rows");
  expect(await table.text()).toContain("1–25 of 40");
  const rows = await Promise.all((await table.host.find({ role: "row" })).map((row) => row.text()));
  expect(rows.filter((row) => !row.includes("Airport.country") && !row.includes("Spain"))).toEqual([]);
});

test("leaving Discover with a dashboard filter in force logs nothing, and the page opens again", async ({ page, env, geoGraph }) => {
  // A frame that comes late, as on a busy machine or in a tab in the background: Mosaic batches its
  // queries behind `requestAnimationFrame`, so what a page queues on its way out runs well after it
  // unmounts: a corpus detached as the page goes, rather than when the cache collects it, is gone
  // under those queries.
  await page.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (run) => frame((t) => setTimeout(() => run(t), 250));
  });
  await saveDashboard(page, geoGraph, "Airport", DASHBOARD);
  const discover = await DiscoverPage.open(page, env, geoGraph, { view: "dashboard" });
  await discover.dashboard();
  const bar = await discover.filters();
  await expect.poll(() => unfiltered(discover, "Airports")).toBe(UNFILTERED);

  await bar.open("Airport.country");
  await page.getByRole("textbox", { name: "Filter values" }).fill("United States");
  await page.getByRole("option", { name: /^United States \d/ }).click();
  await page.keyboard.press("Escape");
  expect(counted(await agreedCount(discover, { figure: "Airports" }))).toBeLessThan(AIRPORTS);
  // The dashboard hidden, its clause still on the page, the canvas drawing what it keeps.
  await discover.view("Graph");
  await expect.poll(() => discover.counts()).toMatch(/ of 3\.2K nodes match/);

  // Leaving by a link unmounts the page in the browser: the dashboard withdraws its clause as it
  // goes, and every client still connected asks again. Those queries must not outlive their clients
  // and run once the corpus is detached (the guard fails the test on the `Catalog Error` they logged).
  // A `goto` would reload the page and tear nothing down.
  await page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "Graphs" }).click();
  await expect(page.getByPlaceholder("Search graphs...")).toBeVisible();
  await page.goBack();
  const graph = await discover.graph();
  await graph.ready();
  await expect.poll(() => graph.counts()).toMatch(/^3\.2K nodes · 36\.9K edges$/);
});

test("the flights rules find what the seed lacks: IATA codes, four-letter ICAO codes, time zones, and flag high airports", async ({ page, env, geoGraph }) => {
  // Beside the dashboard: on CI's software GPU the canvas's layout shares the CPU with rudof, and the
  // check that takes ~10 s beside the dashboard took ~3 min beside the canvas.
  const discover = await DiscoverPage.open(page, env, geoGraph, { view: "dashboard", panel: "rules" });
  const panel = await discover.rules();
  // infra/dev/examples/openflights/rules.ttl, dropped on the panel as a person drops it.
  await panel.drop("rules.ttl", rules("openflights"));
  expect(await panel.checked()).toMatch(/^Checked over all 3,218 nodes/);

  const airport = await panel.rule("Airport");
  // airports.csv: 20 rows with an empty `iata`; 24 whose `icao` is not four capitals (CAJ4, S31, VA1P,
  // …); 29 with an empty `timezone`, a warning; 218 whose `altitude` is above 4,000 ft, a warning too.
  // Nothing else: every position is in range and every route lands on an airport.
  expect(await airport.findings()).toHaveLength(4);
  const expected = [
    ["An airport with scheduled routes has a three-letter IATA code.", "Violation", 20],
    ["An ICAO airport code is four letters.", "Violation", 24],
    ["The airport has no IANA time zone.", "Warning", 29],
    ["A high-altitude airport: takeoff performance is limited.", "Warning", 218],
  ] as const;
  for (const [message, severity, flagged] of expected) {
    const finding = await airport.finding(message);
    expect(await finding.severity(), message).toBe(severity);
    expect(await finding.flagged(), message).toBe(flagged);
  }
  expect(await airport.state()).toBe("2 violations · 2 warnings");

  // Show puts the finding's airports on the page.
  expect(await airport.show("The airport has no IANA time zone.")).toBe(29);
  await expect.poll(() => discover.counts()).toMatch(/^29 of 3\.2K nodes match/);

  // Show all is every airport one severity flags, each once: 20 + 24 violations share no airport,
  // and two of the 29 without a time zone are high too, so 29 + 218 warnings are 245 airports.
  expect(await airport.showAll("warnings")).toBe(245);
  await expect.poll(() => discover.counts()).toMatch(/^245 of 3\.2K nodes match/);
  expect(await airport.showAll("violations")).toBe(44);
  await expect.poll(() => discover.counts()).toMatch(/^44 of 3\.2K nodes match/);
});
