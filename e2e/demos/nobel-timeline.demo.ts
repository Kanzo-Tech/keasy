import { expect } from "@playwright/test";
import { TimelineHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard } from "../support/app";
import { seedGraph } from "../support/seeds";
import { categories } from "./charts";
import { demo } from "./record";

/**
 * Each prize with its laureate and the country the laureate was born in: one relation that holds the
 * gender a reader picks and the country the dashboard ends on. Rooted at the award, so a pick on it
 * keeps awards — the dots on the map — and not laureates, which the map does not place.
 */
const RELATION = "LaureateAward>laureate>Laureate>birthPlace>Country";
const HOPS = [">laureate>Laureate", ">birthPlace>Country"];
const DASHBOARD = {
  filters: [],
  tiles: [
    { id: "gender", kind: "chart", span: 1, type: "bar", title: "Count by Laureate.gender", x: "Laureate.gender", y: { op: "count" } },
    { id: "country", kind: "chart", span: 1, type: "bar", title: "Count by Country.name", x: "Country.name", y: { op: "count" } },
  ],
};

/** The year the timeline's window ends at; NaN with no window. */
const end = async (timeline: TimelineHarness) => Number((await timeline.range())?.slice(-4) ?? Number.NaN);

/**
 * A century of science moving west: the 749 prizes since 1901 whose affiliation has a place, each at
 * the city it was won in, on the map, and the timeline under it. The whole century played; 1900–1930, when nine in ten of the prizes on
 * the map were won in Europe; 1990–2000, when 65 of 86 were won in the US; then only the prizes won
 * by women, the century played again; and the same filter on the dashboard. Off camera: the graph on
 * the map with its edges hidden, the timeline set to the award's year (`date`, `xsd:gYear`), and the
 * dashboard saved and picked. STORYBOARD.md has every figure's query.
 */
demo("nobel-timeline", "Nobel prizes on a map and a timeline: a century of science moving west, then only the women", {
  async arrange({ page, env }) {
    const id = await seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true });
    await saveDashboard(page, id, RELATION, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id);
    // Each award at its first affiliation's city, the edges hidden: the prizes are dots on the map.
    const graph = await discover.onMap();
    await (await discover.settings()).timeline("date");
    // The dashboard's relation is the page's, not the URL's: picked here, so step 5 finds it there.
    await discover.view("Dashboard");
    await discover.relation("LaureateAward", HOPS);
    await discover.dashboard();
    await discover.view("Graph");
    await graph.ready();
    // The settings leave the dock to Info, as on the other maps.
    await discover.panel("Info");
    const timeline = await env.harness(TimelineHarness.with({ title: /^Timeline: / }));
    return { discover, graph, timeline, bar: await discover.filters() };
  },

  steps: ({ discover, graph, timeline, bar }) => {
    /** Play runs inside the brushed range, accumulating: the whole axis brushed, played to its end. */
    const playCentury = async () => {
      await timeline.brush([1900, 2029]);
      await timeline.play();
      await expect.poll(() => end(timeline), { timeout: 120_000 }).toBeGreaterThanOrEqual(2025);
      // At its end Play stops by itself with the whole range kept; this only makes sure.
      await timeline.pause();
    };
    return [
      {
        subtitle: "749 Nobel prizes since 1901, each where it was won",
        async check() {
          expect(await timeline.range()).toBeNull();
          // 749 awards and 370 universities have a position: 1,119 placed of 2.5K nodes.
          expect(await graph.counts()).toMatch(/^1\.1K of 2\.5K nodes placed/);
        },
      },
      {
        subtitle: "Play the whole century",
        action: playCentury,
        check: async () => expect(await end(timeline)).toBeGreaterThanOrEqual(2025),
      },
      {
        subtitle: "1900–1930: 9 in 10 mapped prizes were won in Europe",
        // A drag that starts inside the played window moves it rather than drawing a new one: the
        // window comes off the bar first. Then the toolbar's one Frame, on what the window keeps.
        async action() {
          await bar.remove("date");
          await timeline.brush([1900, 1930]);
          await graph.frame();
        },
        async check() {
          // A harness drag lands on pixels, not on the bars a hand snaps to: an edge may read a year
          // off. Either way it is 9 in 10 — 83 of 93 through 1930, 82 of 90 through 1929.
          expect(await timeline.range()).toMatch(/^19(00|01) – 19(29|30)$/);
          // Every prize in the window, mapped or not: 93 of the 156 through 1930 are on the map.
          await expect.poll(() => discover.kept()).toMatch(/^(156|151)$/);
        },
      },
      {
        subtitle: "1990–2000: 65 of 86 mapped prizes were won in the US",
        async action() {
          await bar.remove("date");
          await timeline.brush([1990, 2000]);
          await graph.frame();
        },
        async check() {
          // The window is inclusive: 2000 is in it.
          expect(await timeline.range()).toBe("1990 – 2000");
          // 86 of the 117 are on the map.
          await expect.poll(() => discover.kept()).toBe("117");
        },
        poster: true,
      },
      {
        subtitle: "Only the women — play the century again",
        // The pick is the dashboard's, crossed onto the awards; the timeline plays under it.
        async action() {
          await discover.view("Dashboard");
          await (await (await (await discover.dashboard()).tile("Count by Laureate.gender")).chart()).pick({ y: "female" });
          // The pick stays on the page through every step after it: its chip is in the bar.
          const picked = async (after: string) =>
            expect(
              (await bar.chips()).some((chip) => /\bLaureate\.gender\b/.test(chip)),
              `the gender pick's chip is in the bar after ${after}`,
            ).toBe(true);
          await expect.poll(async () => (await bar.chips()).some((chip) => /\bLaureate\.gender\b/.test(chip))).toBe(true);
          await discover.view("Graph");
          await picked("the view changed to Graph");
          await graph.ready();
          await picked("the graph was ready");
          await bar.remove("date");
          await picked("the date chip was removed");
          await timeline.brush([1900, 2029]);
          await picked("the century was brushed");
          await timeline.play();
          await expect.poll(() => end(timeline), { timeout: 120_000 }).toBeGreaterThanOrEqual(2025);
          await picked("the century was played");
          await timeline.pause();
        },
        async check() {
          // The pick outlived the view change and the replay: its chip is still in the bar.
          expect((await bar.chips()).some((chip) => /\bLaureate\.gender\b/.test(chip))).toBe(true);
          // 68 prizes went to women, 29 of them with a place on the map.
          // The 68 prizes won by women; 29 of them are on the map.
          await expect.poll(() => discover.kept()).toBe("68");
        },
      },
      {
        subtitle: "One filter, every view",
        action: () => discover.view("Dashboard"),
        async check() {
          const dashboard = await discover.dashboard();
          // Where the 68 women were born: the USA 18, France 6, Poland 5.
          expect((await categories(await dashboard.tile("Count by Country.name")))[0]).toBe("USA");
          const chips = await bar.chips();
          expect(chips.some((chip) => /\bdate\b/.test(chip))).toBe(true);
          expect(chips.some((chip) => /\bLaureate\.gender\b/.test(chip))).toBe(true);
        },
      },
    ];
  },
});
