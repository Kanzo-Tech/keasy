import { expect } from "@playwright/test";
import type { Point } from "@kanzo-tech/testing";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * The Iberian peninsula in lon/lat, the Map placement's own axes. It follows the Portuguese border
 * and the Pyrenees and takes in the Balearics, so it catches 31 airports, every one of them Spanish:
 * 28 on the peninsula, Palma, Ibiza and Menorca. Of the 40 in Spain it leaves out the 8 Canaries and
 * Melilla, and no airport of Portugal, France, Andorra, Gibraltar or Morocco is inside (point in
 * polygon over airports.csv; STORYBOARD.md has the query). A box is no substitute: −10…5 × 35…44.5
 * catches 57, 13 of them in France.
 */
const PENINSULA: Point[] = [
  [-9.5, 44], [-1.7, 43.6], [-1.5, 43.2], [3.3, 42.3], [4.6, 40.2], [4.6, 38.5], [0.5, 38.3],
  [-2, 36.5], [-5.2, 36.3], [-6.4, 36.4], [-7.4, 37.3], [-7.3, 38.5], [-6.6, 40.5], [-6.6, 41.8],
  [-8.2, 41.9], [-9.3, 41.9],
];

/** Frames the force layout draws off camera before it is paused: enough to spread the cloud. Tuned once per machine. */
const SPREAD = 300;

/**
 * Hidden patterns: OpenFlights moving as the force layout spreads it, then put on a map on camera
 * (x = lon, y = lat), so the moving cloud snaps into the world; then every airport in Spain searched
 * into the subset, the peninsula lassoed, and the camera framed on what was kept. Off camera the
 * layout spreads the cloud and is paused, and the 36.9K routes are hidden so the points read. The
 * demos project runs Chromium on the GPU (playwright.config.ts).
 */
demo("flights-map", "OpenFlights put on a map: the force layout's scatter, then longitude and latitude, then Spain lassoed", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    const discover = await DiscoverPage.open(page, env, id);
    const graph = await discover.graph();
    await graph.ready();
    await graph.run();
    await env.until(async () => (await graph.frames()) > SPREAD, "the layout did not spread the cloud");
    await graph.pause();
    const settings = await discover.settings();
    await settings.marks("Legible");
    await settings.edges("Hidden");
    await settings.labels("None");
    await discover.panel("Info");
    return { discover, graph, settings };
  },

  steps: ({ discover, graph, settings }) => [
    {
      subtitle: "A graph of airports, spread by its routes",
      // Woken, so the cloud is moving when the map takes over.
      action: () => graph.run(),
      check: () => expect.poll(() => graph.counts()).toMatch(/\b(3,218|3\.2K) nodes\b/),
    },
    {
      subtitle: "Put it on a map: longitude across, latitude up",
      async action() {
        await discover.panel("Settings");
        await settings.placement("Map", { x: "lon", y: "lat" });
        await graph.pause();
      },
      // `placement` resolves once Map is checked and both axes read their columns.
      check: () => expect.poll(() => graph.frames()).toBeGreaterThan(SPREAD),
      poster: true,
    },
    {
      subtitle: "Find anything — here, every airport in Spain",
      action: async () => (await discover.search()).add("country:Spain", 40),
      check: () => expect.poll(() => graph.counts()).toMatch(/^40 of 3\.2K nodes match/),
    },
    {
      subtitle: "Lasso the peninsula — the Canaries stay out",
      action: () => graph.lasso(PENINSULA, { in: "data" }),
      check: () => expect.poll(() => graph.counts()).toMatch(/^31 of 3\.2K nodes match/),
    },
    {
      subtitle: "Frame what you kept",
      // Resolves on a frame drawn after the press: the camera moved onto what is in full colour.
      action: () => graph.frame(),
      check: () => expect.poll(() => graph.counts()).toMatch(/^31 of 3\.2K nodes match/),
    },
  ],
});
