import { expect } from "@playwright/test";

import { DiscoverPage, saveRules } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Assessment: the rules over OpenFlights, already loaded and checked — the findings read, every
 * airport that breaks a rule shown on the map, then the high-altitude ones, framed. Off camera the
 * example's rules (`infra/dev/examples/openflights/rules.ttl`) are saved as the graph's, the graph is
 * placed on a map with its 36.9K routes hidden, and the dock is collapsed: the rules are the filter
 * bar's badge, and their findings its popover.
 * The Graph view lays out on the GPU: record on a machine with one.
 *
 * Step 2 needs keasy#127 (*Show all N violations*): until it is merged, the take fails there.
 */
demo("flights-rules", "Rules over OpenFlights on the map: the findings, every violation, then the high airports", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    await saveRules(page, id, "openflights");
    const discover = await DiscoverPage.open(page, env, id, { panel: "none" });
    const graph = await discover.onMap();
    // The map at full width: the placement was set in Settings, and the findings are the badge's.
    await (await discover.dock()).close();
    const rules = await discover.rules();
    // rudof in the browser over 3,218 airports: the environment's two minutes cover it.
    expect(await rules.check()).toMatch(/^Checked over all 3,218 nodes$/);
    return { graph, airport: await rules.rule("Airport") };
  },

  steps: ({ graph, airport }) => [
    {
      subtitle: "Every airport, checked against your rules",
      check: async () => expect(await airport.state()).toBe("44 violations · 247 warnings"),
    },
    {
      subtitle: "44 airports break a rule — show them all",
      action: () => airport.showAll("violations"),
      check: () => expect.poll(() => graph.counts()).toMatch(/^44 of 3\.2K nodes match/),
    },
    {
      subtitle: "Amber warns: 218 airports above 4,000 ft",
      action: () => airport.show(/high-altitude airport/),
      check: () => expect.poll(() => graph.counts()).toMatch(/^218 of 3\.2K nodes match/),
      poster: true,
    },
    {
      subtitle: "The Rockies, the Andes, Iran, Ethiopia, Tibet",
      action: () => graph.frame(),
      check: () => expect.poll(() => graph.counts()).toMatch(/^218 of 3\.2K nodes match/),
    },
  ],
});
