import { expect } from "@playwright/test";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Crossfiltering over OpenFlights: one filter for every chart and every view. A country clicked in the
 * Dashboard filters every chart, a longitude range brushed narrows it to the American West, and the
 * Graph view — on a map, set off camera — shows the same airports, framed, in one step.
 */
demo("flights-crossfilter", "Crossfiltering over OpenFlights: a click, a brush, and the same filter on the map", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    const discover = await DiscoverPage.open(page, env, id);
    // The Graph view set for step 3, then the dashboard the story starts on.
    const graph = await discover.onMap();
    await discover.view("Dashboard");
    const dashboard = await discover.dashboard();
    // Every tile drawn before the take starts: the fit's scatter is the slowest, and arrived on camera.
    await dashboard.settled();
    return { discover, graph, dashboard, bar: await discover.filters() };
  },

  steps: ({ discover, graph, dashboard, bar }) => [
    {
      subtitle: "Click a country — every chart follows",
      action: async () => (await (await dashboard.tile(/Count by Airport\.country/)).chart()).pick({ y: "United States" }),
      async check() {
        await expect.poll(() => discover.kept()).toBe("551");
        await dashboard.settled();
      },
    },
    {
      subtitle: "Drag across longitude — just the West",
      action: async () => (await (await dashboard.tile(/Count by Airport\.lon$/)).chart()).brush({ x: [-128, -98.98] }),
      // US airports west of 98.98°W. Both edges sit in gaps of the data — the west one in the 7° between
      // southeast Alaska and the Pacific coast, the east one 0.49° from the nearest airport — so a drag a pixel off
      // still reads the same figure.
      check: () => expect.poll(() => discover.kept()).toBe("135"),
      poster: true,
    },
    {
      subtitle: "Switch to the graph — the same filter, framed on the map",
      // One step: the Graph view, once it has drawn, then its one Frame on what the filters keep.
      async action() {
        await discover.view("Graph");
        await graph.ready();
        await graph.frame();
      },
      async check() {
        await expect.poll(() => discover.kept()).toBe("135");
        const chips = await bar.chips();
        expect(chips.some((chip) => /\bAirport\.country\b/.test(chip))).toBe(true);
        expect(chips.some((chip) => /\bAirport\.lon\b/.test(chip))).toBe(true);
      },
    },
  ],
});
