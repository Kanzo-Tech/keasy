import { expect } from "@playwright/test";
import type { TileHarness } from "@kanzo-tech/testing";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo, model } from "./record";

const BROWSERS = "Which browsers do they use most?";
const OPERA = "Where do the ones on Opera live?";

/** Whether `rows` — an answer's data table — holds a row reading `value` and `n` (thousands separators aside). */
const holds = (rows: Record<string, string>[], value: string, n: number) =>
  rows.some((row) => {
    const cells = Object.values(row);
    return cells.includes(value) && cells.some((cell) => cell.replace(/[,\s]/g, "") === String(n));
  });

/**
 * Ask over LDBC SNB, both of an answer's verbs: the page filtered to women, a question about what is
 * in view whose answer keeps everything in it — every browser, so *Filter the page to these rows* is
 * disabled — added to the dashboard and opened there; then a question whose answer has a where —
 * the women on Opera — and the page filtered to it, the 19 its bars draw framed in the Graph view.
 *
 * The model's words are replayed from `recordings/snb-ask.json` (record/model.ts): the `answer` tool
 * it calls still runs on the page under its filter, so the chart and its rows are DuckDB's on every
 * take. The check that the rows read Firefox 324 — the women's count, not everyone's 628 — proves, on
 * the take that captures it, that the answer is over what is in view. `LIVE=1` asks the model instead;
 * `LIVE=1 RECORD=1` asks it and, once every check has passed, keeps what it said as the recording.
 * The figures are person_0_0.csv's (STORYBOARD.md has the queries).
 */
demo("snb-ask", "Ask over LDBC SNB: an answer added to the dashboard and opened there, then one that filters the page", {
  async arrange({ page, env }) {
    const replay = await model(page, "snb-ask");
    const id = await seedGraph(page, "snb", { name: "Demo · LDBC Social Network", reuse: true });
    // Opened on the dashboard with Ask docked: the Graph view would lay out 327K nodes first.
    const discover = await DiscoverPage.open(page, env, id, { view: "dashboard", panel: "ask" });
    await discover.relation("Person");
    const dashboard = await discover.dashboard();
    // Every tile drawn before the take starts, so none arrives on camera.
    await dashboard.settled();
    const ask = await discover.ask();
    if (replay.live) await ask.warmUp();
    const answers = await ask.composer();
    return { replay, discover, dashboard, answers, answered: { tile: undefined as TileHarness | undefined } };
  },

  steps: ({ replay, discover, dashboard, answers, answered }) => [
    {
      subtitle: "Filter the page: women only",
      action: async () => (await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" }),
      check: () => expect.poll(() => discover.figure("Rows")).toBe("778"),
    },
    {
      subtitle: "Ask about what's in view, in plain words",
      // Resolves once a new answer card has begun.
      action: () => answers.ask(BROWSERS),
      check: async () => expect(replay.unrecorded, "model calls the recording does not hold: capture it again").toEqual([]),
    },
    {
      subtitle: "The answer is a chart, over the women in view",
      action: async () => (answered.tile = await answers.answer()),
      async check() {
        expect(await answered.tile!.text()).toContain("Firefox");
        // The rows the answer was read from, the engine's: 324 of the women; 628 would be everyone's
        // — an answer that dropped the page's filter.
        const rows = await answers.rows();
        expect(holds(rows, "Firefox", 324)).toBe(true);
        expect(holds(rows, "Firefox", 628)).toBe(false);
        // Every browser, and no where: filtering the page to it would keep everything in view.
        await expect(answers.filterTo()).rejects.toThrow(/keeps everything in view/);
      },
      poster: true,
    },
    {
      subtitle: "Add it to the dashboard",
      // Resolves on the card's *Open on the dashboard*, read from the dashboards the page handed back.
      action: () => answers.addToDashboard(),
      check: async () => void (await dashboard.tile(/browserUsed/)),
    },
    {
      subtitle: "Open it on the dashboard",
      // The page's onOpen: the Dashboard view on the answer's relation, the tile brought into view.
      action: () => answers.openOnDashboard(),
      async check() {
        const tile = await dashboard.tile(/browserUsed/);
        await expect
          .poll(async () => {
            const { y, height } = await tile.host.rect();
            return y >= 0 && y + height / 2 <= 900;
          })
          .toBe(true);
      },
    },
    {
      subtitle: "Ask again: where do the ones on Opera live?",
      // The Ask panel stayed docked: the conversation goes on under the same filter.
      async action() {
        await answers.ask(OPERA);
        answered.tile = await answers.answer();
      },
      check: async () => expect(replay.unrecorded, "model calls the recording does not hold: capture it again").toEqual([]),
    },
    {
      // What the answer draws is what it keeps: the 19 women in the 13 countries its bars show, of
      // the 22 on Opera in 16 (STORYBOARD.md).
      subtitle: "This one filters: keep the women it drew",
      action: () => answers.filterTo(),
      check: () => expect.poll(() => discover.figure("Rows")).toBe("19"),
    },
    {
      subtitle: "The same 19 in the graph, framed",
      async action() {
        await discover.view("Graph");
        const graph = await discover.graph();
        await graph.ready();
        await graph.frame();
      },
      check: () => expect.poll(() => discover.counts()).toMatch(/^19 of /),
    },
  ],

  // Only a take whose every check passed is kept as the recording (LIVE=1 RECORD=1).
  passed: ({ replay }) => replay.keep(),
});
