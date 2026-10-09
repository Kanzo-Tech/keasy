import { seedGraph } from "../support/seeds";
import { onMap } from "./geo";
import { demo } from "./record";

/**
 * Crossfiltering over OpenFlights: one filter for every chart and every view. A country clicked in the
 * Dashboard filters every chart, a longitude range brushed narrows it, and the Graph view — on a map,
 * set off camera — shows the same airports. Every clause lands in the filter bar.
 */
demo("flights-crossfilter", "Crossfiltering over OpenFlights: a click, a brush, and the same filter on the map", {
  async arrange(page) {
    await onMap(page, await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true }));
    await page.getByRole("radio", { name: "Dashboard" }).dispatchEvent("click");
    await page.getByRole("heading", { name: /Count by Airport\.country/ }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(900);
  },

  async act({ page, chapter, poster }) {
    const tile = (title: RegExp) =>
      page.locator("article").filter({ has: page.getByRole("heading", { name: title }) }).getByRole("img").first();

    await chapter("One filter, every chart");

    await chapter("Click a country — every chart follows");
    const country = tile(/Count by Airport\.country/);
    const c = await country.boundingBox();
    // Bars are sorted by count, so the top one is the country with the most airports.
    await country.click({ position: { x: c!.width * 0.35, y: c!.height * 0.08 } });
    await page.waitForTimeout(1100);

    await chapter("Drag across longitude — just the West");
    const lon = tile(/Count by Airport\.lon$/);
    const l = await lon.boundingBox();
    await lon.dragTo(lon, {
      // About 125°W to 100°W, the American West, on this histogram's axis.
      sourcePosition: { x: l!.width * 0.231, y: l!.height * 0.5 },
      targetPosition: { x: l!.width * 0.292, y: l!.height * 0.5 },
      steps: 20,
    });
    await page.waitForTimeout(1100);
    await poster();

    await chapter("Switch to the graph — the same filter, on the map");
    await page.getByRole("radio", { name: "Graph" }).click();
    await page.waitForTimeout(900);
    await page.waitForTimeout(1400);

    await chapter("Every filter lands in the bar");
    await page.waitForTimeout(900);
  },
});
