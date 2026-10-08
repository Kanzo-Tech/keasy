import { fileURLToPath } from "node:url";

import { switchPanel } from "../support/fixtures";
import { brush, expect, saveDashboard, test } from "../support/smoke";

/**
 * The OpenFlights dev graph (infra/dev/geo.fossil over `make seed`'s subset): 3,218 airports and the
 * 36,906 direct routes between them. Every number below is the seed's, counted from
 * infra/dev/seed/geo/airports.csv, which `make seed` pins by digest.
 */

const AIRPORTS = 3218;

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
  await page.goto(`/graphs/${geoGraph}/discover`);
  await page.getByRole("radio", { name: "Dashboard" }).click();
  const filters = page.getByRole("region", { name: "Filters" });
  await expect(filters).toContainText(`${AIRPORTS.toLocaleString("en-US")} Airport`, { timeout: 60_000 });

  // What the editor offers is what this dashboard has one of: a kind or a mark added to kanzo-ui's
  // dashboard fails here until the smoke draws it too.
  await page.getByRole("button", { name: "Add tile" }).click();
  const format = page.getByRole("complementary", { name: "Format" });
  await expect(format.getByRole("radio")).toHaveText(["Figure", "Chart", "Table", "Bar", "Line", "Area", "Histogram", "Scatter", "Fit"]);
  await format.getByRole("button", { name: "Cancel" }).click();

  const figure = (title: string) => page.locator('[data-slot="dashboard-figures"] > *').filter({ hasText: title });
  const card = (title: string) => page.locator('[data-slot="dashboard-tiles"] > *').filter({ hasText: title });
  await expect(figure("Airports")).toContainText("3,218");
  for (const title of ["By country", "Altitude along latitude", "Along longitude", "By altitude", "Positions", "Altitude against latitude"]) {
    await expect(card(title).locator("svg").first(), title).toBeVisible();
  }
  await expect(card("By country")).toContainText("United States");
  await expect(card("Airport rows")).toContainText("Airport.iataCode");

  // A brush on the altitude histogram: every other tile reads the airports it keeps, the fit
  // pre-aggregated, and the bar names it as a chip.
  await brush(page, card("By altitude"));
  const readout = filters.getByText(/ of 3,218 Airport$/);
  await expect(readout).toBeVisible();
  const kept = (await readout.textContent())!.split(" of ")[0]!;
  expect(Number(kept.replace(/,/g, ""))).toBeGreaterThan(0);
  expect(Number(kept.replace(/,/g, ""))).toBeLessThan(AIRPORTS);
  await expect(figure("Airports")).toContainText(kept);
  await expect(card("Altitude against latitude").locator("svg").first()).toBeVisible();
  const brushChip = filters.getByRole("button", { name: /^Remove .*Airport\.altitude/ });
  await expect(brushChip).toBeVisible();
  await brushChip.click();
  await expect(filters).toContainText(`${AIRPORTS.toLocaleString("en-US")} Airport`);

  // The dashboard's filter chip: the 40 airports in Spain.
  await filters.getByRole("button", { name: /Airport\.country/ }).click();
  await page.getByRole("searchbox", { name: "Filter values" }).fill("Spain");
  await page.getByRole("option", { name: /^Spain/ }).click();
  await page.keyboard.press("Escape");
  await expect(filters).toContainText("40 of 3,218 Airport");
  await expect(figure("Airports")).toContainText("40");
  await expect(card("By country")).toContainText("Spain");
});

test("the flights rules find what the seed lacks: IATA codes, four-letter ICAO codes, time zones", async ({ page, geoGraph }) => {
  await page.goto(`/graphs/${geoGraph}/discover`);
  await switchPanel(page, "Rules");
  // infra/dev/geo.ttl, dropped on the panel as a person drops it.
  await page.locator('input[type="file"]').setInputFiles(fileURLToPath(new URL("../../infra/dev/geo.ttl", import.meta.url)));
  await expect(page.getByText("Checked over all 3,218 nodes")).toBeVisible({ timeout: 60_000 });

  const airport = page.getByRole("region", { name: "Airport" });
  const finding = (message: string) => airport.locator('[data-slot="diagnostic"]').filter({ hasText: message });
  // airports.csv: 20 rows with an empty `iata`; 24 whose `icao` is not four capitals (CAJ4, S31, VA1P,
  // …); 29 with an empty `timezone`, a warning. Nothing else: every position is in range and every
  // route lands on an airport.
  await expect(airport.locator('[data-slot="diagnostic"]')).toHaveCount(3);
  await expect(finding("An airport with scheduled routes has a three-letter IATA code.")).toContainText("Violation");
  await expect(finding("An airport with scheduled routes has a three-letter IATA code.").getByRole("button", { name: "Show 20" })).toBeVisible();
  await expect(finding("An ICAO airport code is four letters.")).toContainText("Violation");
  await expect(finding("An ICAO airport code is four letters.").getByRole("button", { name: "Show 24" })).toBeVisible();
  await expect(finding("The airport has no IANA time zone.")).toContainText("Warning");
  await expect(finding("The airport has no IANA time zone.").getByRole("button", { name: "Show 29" })).toBeVisible();
  await expect(airport.getByLabel("2 violations")).toBeVisible();
  await expect(airport.getByLabel("1 warnings")).toBeVisible();

  // Show puts the finding's airports on the page.
  await finding("The airport has no IANA time zone.").getByRole("button", { name: "Show 29" }).click();
  await expect(page.locator('[data-slot="graph-counts"]')).toHaveText(/^29 of 3\.2K nodes match/);
});
