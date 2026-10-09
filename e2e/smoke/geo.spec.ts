import { fileURLToPath } from "node:url";

import { discoverUrl } from "../support/fixtures";
import { agreedCount, brush, expect, PLOT, saveDashboard, test } from "../support/smoke";

/**
 * The OpenFlights dev graph (infra/dev/examples/openflights/mapping.fossil over `make seed`'s subset):
 * 3,218 airports and the 36,906 direct routes between them. Every number below is the seed's, counted
 * from infra/dev/examples/openflights/data/airports.csv, which `make seed` pins by digest.
 */

const AIRPORTS = 3218;

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

test("the flights graph opens in Graph view: every airport, and the routes between them", async ({ page, geoGraph }) => {
  await page.goto(`/graphs/${geoGraph}/discover`);
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^3\.2K nodes · 36\.9K edges$/, { timeout: 60_000 });
});

test("the flights dashboard draws every tile kind, and holds under a brush and a filter chip", async ({ page, geoGraph }) => {
  await saveDashboard(page, geoGraph, "Airport", DASHBOARD);
  await page.goto(discoverUrl(geoGraph, { view: "dashboard" }));
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toContainText(`${AIRPORTS.toLocaleString("en-US")} Airport`, { timeout: 60_000 });

  // What the editor offers is what this dashboard has one of: a kind or a mark added to kanzo-ui's
  // dashboard fails here until the smoke draws it too.
  await page.getByRole("button", { name: "Add tile" }).click();
  const format = page.getByRole("complementary", { name: "Format" });
  const offered = async (group: string) =>
    [...(await format.getByRole("radiogroup", { name: group }).ariaSnapshot()).matchAll(/radio "([^"]+)"/g)].map((m) => m[1]);
  expect(await offered("Kind")).toEqual(["Figure", "Chart", "Table"]);
  expect(await offered("Mark")).toEqual(["Bar", "Line", "Area", "Histogram", "Scatter", "Fit"]);
  await format.getByRole("button", { name: "Cancel" }).click();

  const figure = (title: string) => page.locator('[data-slot="dashboard-figures"] > *').filter({ hasText: title });
  const card = (title: string) => page.locator('[data-slot="dashboard-tiles"] > *').filter({ hasText: title });
  await expect(figure("Airports")).toContainText("3,218");
  for (const title of ["By country", "Altitude along latitude", "Along longitude", "By altitude", "Positions", "Altitude against latitude"]) {
    await expect(card(title).locator(PLOT).first(), title).toBeVisible();
  }
  await expect(card("By country")).toContainText("United States");
  await expect(card("Airport rows")).toContainText("Airport.iataCode");

  // A brush on the altitude histogram: every other tile reads the airports it keeps, the fit
  // pre-aggregated, and the bar names it as a chip.
  await brush(page, card("By altitude"));
  const kept = await agreedCount(page, { total: AIRPORTS, noun: "Airport", figure: "Airports" });
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(AIRPORTS);
  await expect(card("Altitude against latitude").locator(PLOT).first()).toBeVisible();
  const brushChip = filters.getByRole("button", { name: /^Remove .*Airport\.altitude/ });
  await expect(brushChip).toBeVisible();
  await brushChip.click();
  await expect(filters).toContainText(`${AIRPORTS.toLocaleString("en-US")} Airport`);

  // The dashboard's filter chip: the 40 airports in Spain.
  await filters.getByRole("button", { name: /^Airport\.country:/ }).click();
  await page.getByRole("textbox", { name: "Filter values" }).fill("Spain");
  // Each value with its count over the whole relation.
  await page.getByRole("option", { name: "Spain 40", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await agreedCount(page, { total: AIRPORTS, noun: "Airport", figure: "Airports" })).toBe(40);
  // The table pages through the 40, every one of them in Spain.
  await expect(card("Airport rows")).toContainText("1–25 of 40");
  await expect(card("Airport rows").getByRole("row").filter({ hasNotText: "Airport.country" }).filter({ hasNotText: "Spain" })).toHaveCount(0);
});

test("leaving Discover with a dashboard filter in force logs nothing, and the page opens again", async ({ page, geoGraph }) => {
  // A frame that comes late, as on a busy machine or in a tab in the background: Mosaic batches its
  // queries behind `requestAnimationFrame`, so what a page queues on its way out runs well after it
  // unmounts: a corpus detached as the page goes, rather than when the cache collects it, is gone
  // under those queries.
  await page.addInitScript(() => {
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (run) => frame((t) => setTimeout(() => run(t), 250));
  });
  await saveDashboard(page, geoGraph, "Airport", DASHBOARD);
  await page.goto(discoverUrl(geoGraph, { view: "dashboard" }));
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toContainText(`${AIRPORTS.toLocaleString("en-US")} Airport`, { timeout: 60_000 });

  await filters.getByRole("button", { name: /^Airport\.country:/ }).click();
  await page.getByRole("textbox", { name: "Filter values" }).fill("United States");
  await page.getByRole("option", { name: /^United States \d/ }).click();
  await page.keyboard.press("Escape");
  await expect(filters).toContainText(/^.*\d[\d,]* of 3,218 Airport/);
  // The dashboard hidden, its clause still on the page, the canvas drawing what it keeps.
  await page.getByRole("radio", { name: "Graph" }).click();
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/ of 3\.2K nodes match/, { timeout: 60_000 });

  // Leaving by a link unmounts the page in the browser: the dashboard withdraws its clause as it
  // goes, and every client still connected asks again. Those queries must not outlive their clients
  // and run once the corpus is detached (the guard fails the test on the `Catalog Error` they logged).
  // A `goto` would reload the page and tear nothing down.
  await page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "Graphs" }).click();
  await expect(page.getByPlaceholder("Search graphs...")).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^3\.2K nodes · 36\.9K edges$/, { timeout: 60_000 });
});

test("the flights rules find what the seed lacks: IATA codes, four-letter ICAO codes, time zones, and flag high airports", async ({ page, geoGraph }) => {
  // Beside the dashboard: on CI's software GPU the canvas's layout shares the CPU with rudof, and the
  // check that takes ~10 s beside the dashboard took ~3 min beside the canvas.
  await page.goto(discoverUrl(geoGraph, { view: "dashboard", panel: "rules" }));
  // infra/dev/examples/openflights/rules.ttl, dropped on the panel as a person drops it.
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../infra/dev/examples/openflights/rules.ttl", import.meta.url)));
  await expect(page.getByText("Checked over all 3,218 nodes")).toBeVisible({ timeout: 60_000 });

  const airport = page.getByRole("region", { name: "Airport" });
  const finding = (message: string) => airport.locator('[data-slot="diagnostic"]').filter({ hasText: message });
  // airports.csv: 20 rows with an empty `iata`; 24 whose `icao` is not four capitals (CAJ4, S31, VA1P,
  // …); 29 with an empty `timezone`, a warning; 218 whose `altitude` is above 4,000 ft, a warning too.
  // Nothing else: every position is in range and every route lands on an airport.
  await expect(airport.locator('[data-slot="diagnostic"]')).toHaveCount(4);
  await expect(finding("An airport with scheduled routes has a three-letter IATA code.")).toContainText("Violation");
  await expect(finding("An airport with scheduled routes has a three-letter IATA code.").getByRole("button", { name: "Show 20" })).toBeVisible();
  await expect(finding("An ICAO airport code is four letters.")).toContainText("Violation");
  await expect(finding("An ICAO airport code is four letters.").getByRole("button", { name: "Show 24" })).toBeVisible();
  await expect(finding("The airport has no IANA time zone.")).toContainText("Warning");
  await expect(finding("The airport has no IANA time zone.").getByRole("button", { name: "Show 29" })).toBeVisible();
  await expect(finding("A high-altitude airport: takeoff performance is limited.")).toContainText("Warning");
  await expect(finding("A high-altitude airport: takeoff performance is limited.").getByRole("button", { name: "Show 218" })).toBeVisible();
  await expect(airport.getByLabel("2 violations")).toBeVisible();
  await expect(airport.getByLabel("2 warnings")).toBeVisible();

  // Show puts the finding's airports on the page.
  await finding("The airport has no IANA time zone.").getByRole("button", { name: "Show 29" }).click();
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^29 of 3\.2K nodes match/);
});
