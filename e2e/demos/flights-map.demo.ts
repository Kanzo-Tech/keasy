import { expect } from "@playwright/test";
import type { Point } from "@kanzo-tech/testing";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * The Iberian peninsula in long/lat, the Map placement's own axes. It follows the Portuguese border
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

/**
 * Hidden patterns: OpenFlights as the force layout leaves it, a cloud, then put on a map on camera
 * (x = long, y = lat), so the cloud snaps into the world; then every airport in Spain searched
 * into the subset and framed — the Canaries and Melilla with the peninsula — then the peninsula
 * lassoed, and the camera framed on what was kept. The layout is not waited on: spread, the cloud
 * looked as it did before, so the wait was a stretch of take where nothing changed. Off camera the
 * 36.9K routes are hidden so the points read. The demos project runs Chromium on the GPU
 * (playwright.config.ts).
 */
demo("flights-map", "OpenFlights put on a map: the force layout's scatter, then longitude and latitude, then Spain lassoed", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights" });
    const discover = await DiscoverPage.open(page, env, id);
    const graph = await discover.graph();
    await graph.ready();
    await graph.pause();
    const settings = await discover.settings();
    await settings.marks("Legible");
    await settings.edges("Hidden");
    await settings.labels("None");
    await settings.backdrop({ vignette: true, grid: true });
    await discover.panel("Info");
    return { discover, graph, settings };
  },

  steps: ({ discover, graph, settings }, { page }) => [
    {
      subtitle: "A graph of airports and their routes",
      // Woken, so the cloud is moving when the map takes over.
      action: () => graph.run(),
      check: () => expect.poll(() => graph.counts()).toMatch(/\b(3,218|3\.2K) nodes\b/),
    },
    {
      subtitle: "Put it on a map: longitude across, latitude up",
      async action() {
        await discover.panel("Settings");
        await settings.placement("Map", { x: "long", y: "lat" });
        await graph.pause();
      },
      // `placement` resolves once Map is checked and both axes read their columns. On the map the
      // positions are the data's and nothing lays out: a layout running over them pushes the points
      // against the square's walls, so the take fails here rather than posters that.
      async check() {
        await expect.poll(() => graph.counts()).toMatch(/\b(3,218|3\.2K) of (3,218|3\.2K) (nodes )?placed\b/);
        await expect(page.getByRole("button", { name: /^(Resume|Run) the layout$/ })).toBeVisible();
      },
      poster: true,
    },
    {
      subtitle: "Find anything — here, every airport in Spain",
      action: async () => (await discover.search()).add("country:Spain", 40),
      check: () => expect.poll(() => discover.kept()).toBe("40"),
    },
    {
      subtitle: "Frame Spain",
      // The toolbar's one Frame, on what the search kept: the 40, the Canaries and Melilla with them.
      action: () => graph.frame(),
      check: () => expect.poll(() => discover.kept()).toBe("40"),
    },
    {
      subtitle: "Lasso the peninsula — the Canaries stay out",
      action: () => graph.lasso(PENINSULA, { in: "data" }),
      check: () => expect.poll(() => discover.kept()).toBe("31"),
    },
    {
      subtitle: "Frame what you kept",
      // Resolves on a frame drawn after the press: the camera moved onto what is in full colour.
      action: () => graph.frame(),
      check: () => expect.poll(() => discover.kept()).toBe("31"),
    },
  ],
});
