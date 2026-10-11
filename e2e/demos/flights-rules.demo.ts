import { expect } from "@playwright/test";

import { DiscoverPage, saveRules } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Assessment: the rules over OpenFlights, already loaded and checked — every airport checked, the
 * airports that break the rule shown on the map and framed, then the high-altitude ones and framed,
 * and last what conforms kept: the clean set is the page. Off camera the example's rules
 * (`infra/dev/examples/openflights/rules.ttl`) are saved as the graph's, the graph is placed on a map
 * with its 36.9K routes hidden, and the dock is collapsed: the rules are the filter bar's badge, and
 * their findings its popover. The Graph view lays out on the GPU: record on a machine with one.
 *
 * The figures are airports.csv's (STORYBOARD.md has the queries): 288 airports carry a result of
 * either severity — 44 with a violation, 245 with a warning, one with both — so 2,930 conform; 218
 * sit above 4,000 ft.
 */
demo("flights-rules", "Rules over OpenFlights on the map: what breaks the rule, the high airports, then only what conforms", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "openflights", { name: "Demo · OpenFlights", reuse: true });
    await saveRules(page, id, "openflights");
    const discover = await DiscoverPage.open(page, env, id, { panel: "none" });
    const graph = await discover.onMap();
    // The map at full width: the placement was set in Settings, and the findings are the badge's.
    await (await discover.dock()).close();
    const rules = await discover.rules();
    // rudof in the browser over 3,218 airports: the environment's two minutes cover it.
    expect(await rules.check()).toBe("All 3,218 nodes checked · 2,930 conform");
    return { discover, graph, rules, airport: await rules.rule("Airport") };
  },

  steps: ({ discover, graph, rules, airport }) => [
    {
      subtitle: "Every airport, checked against your rules",
      check: async () => expect(await airport.state()).toBe("44 violations · 247 warnings"),
    },
    {
      subtitle: "288 airports break the rule — show them all",
      // The rule's own Show N, at the end of its heading: every airport it flags, of either severity.
      action: () => airport.showAll(),
      check: () => expect.poll(() => discover.kept()).toBe("288"),
    },
    {
      subtitle: "Frame them",
      action: () => graph.frame(),
      check: () => expect.poll(() => discover.kept()).toBe("288"),
    },
    {
      subtitle: "Amber warns: 218 airports above 4,000 ft",
      // The finding's own Show N, on its item: it replaces the rule's, the rules being one clause.
      action: () => airport.show(/high-altitude airport/),
      check: () => expect.poll(() => discover.kept()).toBe("218"),
      poster: true,
    },
    {
      subtitle: "Frame them: the Rockies, the Andes, Tibet",
      action: () => graph.frame(),
      check: () => expect.poll(() => discover.kept()).toBe("218"),
    },
    {
      subtitle: "Keep what conforms: 2,930 airports pass every rule",
      // The airports rudof names as conforming beside its Shape Fragment are the page: the readout counts them.
      action: () => rules.conforms(),
      check: () => expect.poll(() => discover.kept()).toBe("2,930"),
    },
  ],
});
