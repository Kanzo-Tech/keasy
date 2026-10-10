import { expect } from "@playwright/test";

import { DiscoverPage, saveRules } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Assessment: the rules over OpenFlights, already loaded and checked — the findings read, every
 * airport that breaks a rule shown on the map, then the high-altitude ones, framed. Off camera the
 * example's rules (`infra/dev/examples/openflights/rules.ttl`) are saved as the graph's, the graph is
 * placed on a map with its 36.9K routes hidden, and the dock is widened so the findings' columns fit.
 * The Graph view lays out on the GPU: record on a machine with one.
 *
 * Step 2 needs keasy#127 (*Show all N violations*): until it is merged, the take fails there.
 */
demo("flights-rules", "Rules over OpenFlights on the map: the findings, every violation, then the high airports", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    await saveRules(page, id, "openflights");
    const discover = await DiscoverPage.open(page, env, id, { panel: "rules" });
    const graph = await discover.onMap();
    const rules = await discover.rules();
    await discover.widenDock(280);
    // rudof in the browser over 3,218 airports: the environment's two minutes cover it.
    expect(await rules.checked()).toMatch(/^Checked over all 3,218 nodes$/);
    return { graph, airport: await rules.rule("Airport"), bar: await discover.filters() };
  },

  steps: ({ graph, airport, bar }) => [
    {
      subtitle: "Every airport, checked against your rules",
      check: async () => expect(await airport.state()).toBe("2 violations · 2 warnings"),
    },
    {
      subtitle: "44 airports break a rule — show them all",
      action: () => airport.showAll("violations"),
      check: () => expect.poll(() => bar.readout()).toMatch(/^44 of 3,218\b/),
    },
    {
      subtitle: "Amber warns: 218 airports above 4,000 ft",
      action: () => airport.show(/high-altitude airport/),
      check: () => expect.poll(() => bar.readout()).toMatch(/^218 of 3,218\b/),
      poster: true,
    },
    {
      subtitle: "The Rockies, the Andes, Iran, Ethiopia, Tibet",
      action: () => graph.frame(),
      check: () => expect.poll(() => bar.readout()).toMatch(/^218 of 3,218\b/),
    },
  ],
});
