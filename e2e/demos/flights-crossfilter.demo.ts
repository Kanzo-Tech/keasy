import { expect } from "@playwright/test";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Crossfiltering over OpenFlights: one filter for every chart and every view. A country clicked in the
 * Dashboard filters every chart, a longitude range brushed narrows it to the American West, and the
 * Graph view — on a map, set off camera — shows the same airports, framed.
 */
demo("flights-crossfilter", "Crossfiltering over OpenFlights: a click, a brush, and the same filter on the map", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    const discover = await DiscoverPage.open(page, env, id);
    // The Graph view set for step 3, then the dashboard the story starts on.
    const graph = await discover.onMap();
    await discover.view("Dashboard");
    return { discover, graph, dashboard: await discover.dashboard(), bar: await discover.filters() };
  },

  steps: ({ discover, graph, dashboard, bar }) => [
    {
      subtitle: "Click a country — every chart follows",
      action: async () => (await (await dashboard.tile(/Count by Airport\.country/)).chart()).pick({ y: "United States" }),
      async check() {
        await expect.poll(() => discover.figure("Rows")).toBe("551");
        await dashboard.settled();
      },
    },
    {
      subtitle: "Drag across longitude — just the West",
      action: async () => (await (await dashboard.tile(/Count by Airport\.lon$/)).chart()).brush({ x: [-125, -100] }),
      // US airports between 125°W and 100°W. A brush that snaps to the histogram's bins reads otherwise:
      // pin the figure from the first take.
      check: () => expect.poll(() => discover.figure("Rows")).toBe("132"),
      poster: true,
    },
    {
      subtitle: "Switch to the graph — the same filter, on the map",
      async action() {
        await discover.view("Graph");
        await graph.ready();
      },
      async check() {
        await expect.poll(() => graph.counts()).toMatch(/^132 match · 3\.2K of 3\.2K placed/);
      },
    },
    {
      subtitle: "Frame what the filters keep",
      action: () => graph.frame(),
      async check() {
        const chips = await bar.chips();
        expect(chips.some((chip) => /\bAirport\.country\b/.test(chip))).toBe(true);
        expect(chips.some((chip) => /\bAirport\.lon\b/.test(chip))).toBe(true);
      },
    },
  ],
});
