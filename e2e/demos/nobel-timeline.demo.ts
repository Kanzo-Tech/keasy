import { expect } from "@playwright/test";
import { TimelineHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard } from "../support/app";
import { hasExample, seedGraph } from "../support/seeds";
import { categories } from "./charts";
import { demo } from "./record";

/** Each prize's affiliation, with the country of the university it was won at. */
const RELATION = "LaureateAward>university>University>addressCountry>Country";
const DASHBOARD = {
  filters: [],
  tiles: [{ id: "country", kind: "chart", span: 1, type: "bar", title: "Count by Country.name", x: "Country.name", y: { op: "count" } }],
};

/** Frames the force layout draws off camera before it is paused. */
const SPREAD = 300;

/**
 * The timeline needs keasy#128 (a timeline under the graph, the *Timeline* setting) and the Nobel
 * example keasy#119; neither is on main yet. When both are, this is empty and the demo records.
 */
const WAITING = [!hasExample("nobel") && "the Nobel example (keasy#119)", "the timeline under the graph (keasy#128)"].filter(Boolean);

/**
 * The Nobel timeline: every prize since 1901 on one time axis under the graph. A window brushed over
 * 1901–1929, when German universities led; played forward, the prizes go west in the 1940s; and the
 * 1990s on the dashboard, where 58 of 78 affiliations are American. Off camera: the timeline set to
 * the award's year (`date`, `xsd:gYear`), the layout spread, and the dashboard saved.
 */
demo("nobel-timeline", "Nobel prizes on a timeline: brush the early years, play it forward, read the 1990s", {
  skip: WAITING.length > 0 && `needs ${WAITING.join(" and ")} on main`,

  async arrange({ page, env }) {
    const id = await seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true });
    await saveDashboard(page, id, RELATION, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id);
    const graph = await discover.graph();
    await graph.ready();
    const settings = await discover.settings();
    await settings.timeline("date");
    await settings.marks("Legible");
    await settings.labels("None");
    await graph.run();
    await env.until(async () => (await graph.frames()) > SPREAD, "the layout did not spread the graph");
    await graph.pause();
    const timeline = await env.harness(TimelineHarness.with({ title: /^Timeline: / }));
    return { discover, graph, timeline, bar: await discover.filters() };
  },

  steps: ({ discover, graph, timeline, bar }) => [
    {
      subtitle: "Every Nobel prize since 1901, on one time axis",
      async check() {
        expect(await timeline.range()).toBeNull();
        expect(await graph.counts()).not.toMatch(/ of /);
      },
    },
    {
      subtitle: "Brush 1901–1929: German universities lead",
      action: () => timeline.brush([new Date("1901-01-01"), new Date("1930-01-01")]),
      async check() {
        expect(await timeline.range()).toMatch(/^1901 – 19(29|30)$/);
        expect((await bar.chips()).some((chip) => /\bdate\b/.test(chip))).toBe(true);
      },
    },
    {
      subtitle: "Play it forward — in the 1940s the prizes go west",
      async action() {
        await timeline.play();
        await expect.poll(async () => (await timeline.range()) ?? "", { timeout: 60_000 }).toMatch(/^19[89]\d/);
        await timeline.pause();
      },
      // `pause` resolves once the play button is no longer pressed; the window stays where it stopped.
      check: async () => expect(await timeline.range()).toMatch(/^19[89]\d/),
    },
    {
      subtitle: "The 1990s: 58 of 78 affiliations are American",
      action: () => timeline.brush([new Date("1990-01-01"), new Date("2000-01-01")]),
      check: async () => expect(await timeline.range()).toMatch(/^1990 – (1999|2000)$/),
    },
    {
      subtitle: "One filter, every view",
      action: () => discover.view("Dashboard"),
      async check() {
        const dashboard = await discover.dashboard();
        expect((await categories(await dashboard.tile("Count by Country.name")))[0]).toBe("USA");
        // The timeline's clause holds on the dashboard.
        expect((await bar.chips()).some((chip) => /\bdate\b/.test(chip))).toBe(true);
      },
      poster: true,
    },
  ],
});
