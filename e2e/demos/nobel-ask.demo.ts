import { expect } from "@playwright/test";
import type { ModelTurn, TileHarness } from "@kanzo-tech/testing";

import { DiscoverPage, saveDashboard } from "../support/app";
import { scriptModel } from "../support/model";
import { seedGraph } from "../support/seeds";
import { demo } from "./record";

/** Each prize with its category: the relation the dashboard's one tile picks Physics on. */
const RELATION = "LaureateAward>category>Category";
const HOPS = [">category>Category"];
const DASHBOARD = {
  filters: [],
  tiles: [{ id: "category", kind: "chart", span: 1, type: "bar", x: "category.name", y: { op: "count" } }],
};

const UNIVERSITIES = "Which universities won the most prizes?";
const GERMANY = "Which ones were won in Germany?";

/**
 * What the model answers, by the question its prompt carries. The second question's prompt carries the
 * first, as the answer it follows, so it is looked for first. Each is the spec a good answer is: the
 * prizes counted by university, the eight on top; then the same, narrowed to a university in Germany.
 * The relation each needs is the page's to find, and the rows are DuckDB's, under the page's filter.
 */
const BY_UNIVERSITY = { of: "LaureateAward", show: { kind: "chart", type: "bar", x: "university.name", y: { op: "count" } }, top: 8 };
const TURNS: ModelTurn[] = [
  { when: `Question: ${GERMANY}`, reply: { text: JSON.stringify({ spec: { ...BY_UNIVERSITY, where: [{ field: "university.addressCountry.name", in: ["Germany"] }] } }) } },
  { when: `Question: ${UNIVERSITIES}`, reply: { text: JSON.stringify({ spec: BY_UNIVERSITY }) } },
];

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
 * The model is a double (`support/model.ts`), as `nobel-assistant`'s is: a recording that depended
 * on a small model filling the same spec on every take would be a different film each time, and what
 * the model in the page answers is the evaluation set's to measure (kanzo-ui's `packages/ai/eval`). Everything else is the
 * stack's: the relation each answer needs is found by the page, and the chart and its rows are
 * DuckDB's, read under the page's filter. The check that the University of California reads 16 — its
 * Physics prizes, not its 43 in every category — proves that the answer is over what is in view. The
 * figures are `nobel/data`'s (STORYBOARD.md has the queries).
 */
demo("nobel-ask", "Ask over the Nobel prizes: an answer added to the dashboard and opened there, then one that filters the map", {
  async arrange({ page, env }) {
    await scriptModel(page, { turns: TURNS });
    const id = await seedGraph(page, "nobel", { name: "Demo · Nobel laureates" });
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
    await ask.warmUp();
    const answers = await ask.composer();
    return { discover, graph, dashboard, answers, answered: { tile: undefined as TileHarness | undefined } };
  },

  steps: ({ discover, graph, dashboard, answers, answered }) => [
    {
      subtitle: "Filter the page: Physics only",
      action: async () => (await (await dashboard.tile("Count by category.name")).chart()).pick({ y: "Physics" }),
      check: () => expect.poll(() => discover.kept()).toBe("230"),
    },
    {
      subtitle: "Ask about what's in view, in plain words",
      // Resolves once a new answer card has begun.
      action: () => answers.ask(UNIVERSITIES),
      // The action is the check: it resolves only once a new answer card has begun.
      check: async () => {},
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
      // The action is the check. The tile lands on the dashboard of the answer's relation — prizes by
      // university — not the one in view, by category: the next step opens it there.
      check: async () => {},
    },
    {
      subtitle: "Open it on the dashboard",
      // The page's onOpen: the Dashboard view on the answer's relation, the tile brought into view.
      action: () => answers.openOnDashboard(),
      async check() {
        // By its title: the automatic tiles' table has a university.name column too.
        const tile = await dashboard.tile("Count by university.name");
        await expect
          .poll(async () => {
            const { top: y, height } = await tile.host.getDimensions();
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
      // An answer read from rows, the engine's: the next step keeps them.
      check: async () => expect((await answers.rows()).length).toBeGreaterThan(0),
    },
    {
      // What the answer draws is what it keeps: of the 22 Physics prizes won at a German institution,
      // the ones in the categories its bars show (STORYBOARD.md).
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
        await discover.view("Graph");
        await graph.ready();
        await graph.frame();
      },
      // The readout counts the Graph view's nodes now — the prizes and their universities — not the
      // dashboard's rows, so the two figures differ. Some are kept, and no more than the 22 Physics
      // prizes at a German institution and their 21 institutions (STORYBOARD.md).
      check: async () => {
        const kept = Number((await discover.kept()).replace(/,/g, ""));
        expect(kept).toBeGreaterThan(0);
        expect(kept).toBeLessThanOrEqual(22 + 21);
      },
    },
  ],
});
