import { expect } from "@playwright/test";
import type { TileHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo, model } from "./record";

/** Each prize with its category: the relation the dashboard's one tile picks Physics on. */
const RELATION = "LaureateAward>category>Category";
const HOPS = [">category>Category"];
const DASHBOARD = {
  filters: [],
  tiles: [{ id: "category", kind: "chart", span: 1, type: "bar", title: "Count by Category.name", x: "Category.name", y: { op: "count" } }],
};

// "Prizes" points the model at the awards, which the page's Physics filter reaches; asked for
// universities alone, a small model counted the University type, which the filter cannot narrow, and
// read no rows.
const UNIVERSITIES = "Which universities won the most prizes?";
const GERMANY = "Which ones were won in Germany?";

/** Whether `rows` — an answer's data table — holds a row reading `value` and `n` (thousands separators aside). */
const holds = (rows: Record<string, string>[], value: string, n: number) =>
  rows.some((row) => {
    const cells = Object.values(row);
    return cells.includes(value) && cells.some((cell) => cell.replace(/[,\s]/g, "") === String(n));
  });

/**
 * Ask over the Nobel prizes, both of an answer's verbs: the page filtered to Physics, a question about
 * what is in view whose answer ranks universities — added to the dashboard and opened there; then a
 * question whose answer has a where — the prizes won in Germany — and the page filtered to it, framed
 * on the map, where the graph is 2.5K nodes and the frame is instant. It replaced `snb-ask`, whose last
 * frame laid out LDBC's 327K nodes, and whose browsers `snb-explore` had already filtered by.
 *
 * The model's words are replayed from `recordings/nobel-ask.json` (record/model.ts): the `answer` tool
 * it calls still runs on the page under its filter, so the chart and its rows are DuckDB's on every
 * take. The check that the University of California reads 16 — its Physics prizes, not its 43 in every
 * category — proves, on the take that captures it, that the answer is over what is in view. `LIVE=1`
 * asks the model instead; `LIVE=1 RECORD=1` asks it and, once every check has passed, keeps what it
 * said as the recording. The figures are `nobel/data`'s (STORYBOARD.md has the queries).
 */
demo("nobel-ask", "Ask over the Nobel prizes: an answer added to the dashboard and opened there, then one that filters the map", {
  async arrange({ page, env }) {
    const replay = await model(page, "nobel-ask");
    const id = await seedGraph(page, "nobel", { name: "Demo · Nobel laureates", reuse: true });
    await saveDashboard(page, id, RELATION, DASHBOARD);
    const discover = await DiscoverPage.open(page, env, id);
    // The Graph view on the map for the last step, then the dashboard the story starts on, Ask docked.
    const graph = await discover.onMap();
    await discover.view("Dashboard");
    await discover.relation("LaureateAward", HOPS);
    const dashboard = await discover.dashboard();
    // Every tile drawn before the take starts, so none arrives on camera.
    await dashboard.settled();
    await discover.panel("Ask");
    const ask = await discover.ask();
    if (replay.live) await ask.warmUp();
    const answers = await ask.composer();
    return { replay, discover, graph, dashboard, answers, answered: { tile: undefined as TileHarness | undefined } };
  },

  steps: ({ replay, discover, graph, dashboard, answers, answered }) => [
    {
      subtitle: "Filter the page: Physics only",
      action: async () => (await (await dashboard.tile("Count by Category.name")).chart()).pick({ y: "Physics" }),
      check: () => expect.poll(() => discover.kept()).toBe("230"),
    },
    {
      subtitle: "Ask about what's in view, in plain words",
      // Resolves once a new answer card has begun.
      action: () => answers.ask(UNIVERSITIES),
      check: async () => expect(replay.unrecorded, "model calls the recording does not hold: capture it again").toEqual([]),
    },
    {
      subtitle: "The answer is a chart, over the Physics prizes in view",
      action: async () => (answered.tile = await answers.answer()),
      async check() {
        // Ranked by university: a long name is an axis label the chart truncates, so the rows say who.
        expect(await answered.tile!.text()).toMatch(/University/);
        // The rows the answer was read from, the engine's: 16 of the Physics prizes; 43 would be every
        // category's — an answer that dropped the page's filter.
        const rows = await answers.rows();
        expect(holds(rows, "University of California", 16)).toBe(true);
        expect(holds(rows, "University of California", 43)).toBe(false);
      },
      poster: true,
    },
    {
      subtitle: "Add it to the dashboard",
      // Resolves on the card's *Open on the dashboard*, read from the dashboards the page handed back.
      action: () => answers.addToDashboard(),
      check: async () => void (await dashboard.tile(/University/)),
    },
    {
      subtitle: "Open it on the dashboard",
      // The page's onOpen: the Dashboard view on the answer's relation, the tile brought into view.
      action: () => answers.openOnDashboard(),
      async check() {
        const tile = await dashboard.tile(/University/);
        await expect
          .poll(async () => {
            const { y, height } = await tile.host.rect();
            return y >= 0 && y + height / 2 <= 900;
          })
          .toBe(true);
      },
    },
    {
      subtitle: "Ask again: which ones were won in Germany?",
      // The Ask panel stayed docked: the conversation goes on under the same filter.
      async action() {
        await answers.ask(GERMANY);
        answered.tile = await answers.answer();
      },
      check: async () => expect(replay.unrecorded, "model calls the recording does not hold: capture it again").toEqual([]),
    },
    {
      // What the answer draws is what it keeps: of the 22 Physics prizes won at a German institution,
      // the ones in the categories its bars show (STORYBOARD.md). Pinned on the take that captures it.
      subtitle: "This one filters: keep what it found",
      action: () => answers.filterTo(),
      check: () =>
        expect
          .poll(async () => Number((await discover.kept()).replace(/,/g, "")))
          .toBeGreaterThan(0),
    },
    {
      subtitle: "The same prizes on the map, framed on Germany",
      async action() {
        const kept = await discover.kept();
        await discover.view("Graph");
        await graph.ready();
        await graph.frame();
        // The readout counts the Graph view's nodes now: the same prizes, every one of them on the map.
        await expect.poll(() => discover.kept()).toBe(kept);
      },
      check: async () => expect(Number((await discover.kept()).replace(/,/g, ""))).toBeLessThanOrEqual(22),
    },
  ],

  // Only a take whose every check passed is kept as the recording (LIVE=1 RECORD=1).
  passed: ({ replay }) => replay.keep(),
});
