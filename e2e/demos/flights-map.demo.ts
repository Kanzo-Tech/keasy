import { seedGraph } from "../support/seeds";
import { hideEdges, openGraphView, pauseLayout, placeOnMap, showPanel } from "./geo";
import { demo } from "./record";

/**
 * OpenFlights put on a map: the airports moving as the force layout spreads them, then Placement → Map
 * with x = lon and y = lat on camera, so the moving cloud snaps into the world. Then one country
 * searched into the subset. Off camera the layout spreads the cloud and is paused, so Settings opens
 * at once, and the 36.9K routes are hidden so the points read; on camera it is woken to move again.
 * The demos project runs Chromium on the GPU (playwright.config.ts).
 */
demo("flights-map", "OpenFlights put on a map: the force layout's scatter, then longitude and latitude, then one country", {
  async arrange(page) {
    await openGraphView(page, await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true }));
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(6000);
    await pauseLayout(page);
    await showPanel(page, "Settings");
    await hideEdges(page);
    await showPanel(page, "Info");
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(800);
  },

  async act({ page, chapter, poster }) {
    // Woken, so the cloud is moving when the map takes over.
    await page.getByRole("button", { name: /^(Resume|Run) the layout$/ }).click();
    await chapter("A graph of airports, spread by its links");

    await chapter("Put it on a map: longitude across, latitude up");
    await placeOnMap(page);
    await pauseLayout(page);
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(1300);
    await poster();

    await chapter("Find anything — here, every airport in Spain");
    await showPanel(page, "Info");
    await page.getByRole("button", { name: /Find anything in the graph/ }).click();
    await page.getByPlaceholder("Find anything in the graph…").pressSequentially("country:Spain", { delay: 60 });
    await page.getByRole("button", { name: /^Add \d[\d,]* to the subset/ }).click({ timeout: 30_000 });
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(1400);

    await chapter("The map keeps only what you picked");
    // eslint-disable-next-line playwright/no-wait-for-timeout -- replaced by @kanzo-tech/testing in part 2
    await page.waitForTimeout(1200);
  },
});
