import { expect } from "@playwright/test";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/**
 * Analytics over LDBC SNB's Dashboard view — a root type picked, a bar clicked, a range brushed, and
 * the filters that land in the bar. A new demo is a file like this one beside it, transcribed from
 * its table in STORYBOARD.md: a subtitle, an action and a check per step.
 */
demo("snb-explore", "Dashboard over LDBC SNB: pick a type, click a bar, brush a range", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "snb", { name: "Demo · LDBC Social Network", reuse: true });
    // Opened on the dashboard: the Graph view would lay out 327K nodes first.
    const discover = await DiscoverPage.open(page, env, id, { view: "dashboard" });
    return { discover, dashboard: await discover.dashboard(), bar: await discover.filters() };
  },

  steps: ({ discover, dashboard, bar }, { page }) => [
    {
      subtitle: "Pick what to explore",
      action: () => discover.relation("Person"),
      async check() {
        await dashboard.tile("Count by Person.gender");
        // 1,528 people, and no filter yet.
        await expect.poll(() => bar.readout()).toMatch(/^1,528\b/);
      },
    },
    {
      subtitle: "Every column gets a chart — click a bar to filter",
      action: async () => (await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" }),
      async check() {
        await expect.poll(() => bar.readout()).toMatch(/^778 of 1,528\b/);
        expect((await bar.chips()).some((chip) => chip.startsWith("Person.gender"))).toBe(true);
      },
    },
    {
      subtitle: "Drag across time to narrow it further",
      action: async () =>
        (await (await dashboard.tile("Count by Person.birthday")).chart()).brush({ x: [new Date("1985-01-01"), new Date("1990-01-01")] }),
      // Women born 1985–1989. A histogram may snap the brush to its bins: if it reads otherwise, the
      // bins are what it counted — pin the figure from the first take.
      check: () => expect.poll(() => bar.readout()).toMatch(/^391 of 1,528\b/),
      poster: true,
    },
    {
      subtitle: "Every filter lands in the bar",
      // A hover, which no harness has: the one raw call of the demo, on the chip by its role.
      action: () => page.getByRole("region", { name: "Filters" }).getByRole("button", { name: /Person\.gender/ }).first().hover(),
      async check() {
        const chips = await bar.chips();
        expect(chips.filter((chip) => /^Person\.(gender|birthday)/.test(chip))).toHaveLength(2);
      },
    },
  ],
});
