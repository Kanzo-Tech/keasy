import { expect } from "@playwright/test";
import { TimelineHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard } from "../support/app";
import { seedGraph } from "../support/seeds";
import { categories } from "./charts";
import { demo } from "./record";

/** Each prize's affiliation, with the country of the university it was won at. */
const RELATION = "LaureateAward>university>University>addressCountry>Country";
const DASHBOARD = {
  filters: [],
  tiles: [{ id: "country", kind: "chart", span: 1, type: "bar", title: "Count by Country.name", x: "Country.name", y: { op: "count" } }],
};

/** The year the timeline's window ends at; NaN with no window. */
const end = async (timeline: TimelineHarness) => Number((await timeline.range())?.slice(-4) ?? Number.NaN);

/**
 * The Nobel timeline: every prize since 1901 on one time axis under the graph, in bars of five years
 * a brush snaps to. A window over 1900–1930, when German universities led; played forward, the prizes
 * go west in the 1940s as 1900–1960 plays; and 1990–2000 on the dashboard, where 66 of 89 affiliations are American (the
 * window is inclusive: 2000 is in it). Off camera: the timeline set to the award's year (`date`,
 * `xsd:gYear`), the graph put on the map with its edges hidden, and the dashboard saved.
 */
demo("nobel-timeline", "Nobel prizes on a timeline: brush the early years, play it forward, read the 1990s", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true });
    await saveDashboard(page, id, RELATION, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id);
    // Each award at its first affiliation's city, the edges hidden: the prizes are dots on the map.
    const graph = await discover.onMap();
    await (await discover.settings()).timeline("date");
    // The settings leave the dock to Info, as on the other maps.
    await discover.panel("Info");
    const timeline = await env.harness(TimelineHarness.with({ title: /^Timeline: / }));
    return { discover, graph, timeline, bar: await discover.filters() };
  },

  steps: ({ discover, graph, timeline, bar }) => [
    {
      subtitle: "Every Nobel prize since 1901, on one time axis",
      async check() {
        expect(await timeline.range()).toBeNull();
        expect(await graph.counts()).toMatch(/^1\.1K of 2\.5K nodes placed/);
      },
    },
    {
      subtitle: "Brush 1900–1930: German universities lead",
      action: () => timeline.brush([1900, 1930]),
      async check() {
        // A harness drag lands on pixels, not on the bars a hand snaps to: an edge may read a year off.
        expect(await timeline.range()).toMatch(/^19(00|01) – 19(29|30)$/);
        expect((await bar.chips()).some((chip) => /\bdate\b/.test(chip))).toBe(true);
      },
    },
    {
      subtitle: "Play 1900–1960 — in the 1940s the prizes go west",
      // Play runs inside the brushed range and fills it from its start, a bar a tick: the range is
      // widened to the 1960s first, so the 1940s come in as it plays.
      async action() {
        await bar.remove("date");
        await timeline.brush([1900, 1960]);
        await timeline.play();
        await expect.poll(() => end(timeline), { timeout: 60_000 }).toBeGreaterThanOrEqual(1955);
        await timeline.pause();
      },
      check: async () => expect(await end(timeline)).toBeGreaterThanOrEqual(1955),
    },
    {
      subtitle: "1990–2000: 66 of 89 affiliations are American",
      // A drag that starts inside the paused window moves it rather than drawing a new one: the
      // window comes off the bar first.
      async action() {
        await bar.remove("date");
        await timeline.brush([1990, 2000]);
      },
      check: async () => expect(await timeline.range()).toBe("1990 – 2000"),
    },
    {
      subtitle: "One filter, every view",
      async action() {
        await discover.view("Dashboard");
        // The Dashboard opens on the graph's first type: the affiliations' relation is picked, as a person picks it.
        await discover.relation("LaureateAward", [">university>University", ">addressCountry>Country"]);
      },
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
