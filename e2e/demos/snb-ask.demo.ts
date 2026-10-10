import { expect } from "@playwright/test";
import type { TileHarness } from "@kanzo-tech/testing";

import { DiscoverPage } from "../support/app";
import { seedGraph } from "../support/seeds";
import { demo, model } from "./record";

const QUESTION = "Which browsers do they use most?";

/**
 * Ask over LDBC SNB: the page filtered to women, a question in plain words about what is in view, the
 * answer as a chart over those women, and the answer added to the dashboard.
 *
 * The model's words are replayed from `recordings/snb-ask.json` (record/model.ts): the `answer` tool
 * it calls still runs on the page under its filter, so the chart is DuckDB's on every take. The check
 * that the reply reads Firefox 324 — the women's count, not everyone's 628 — proves, on the take that
 * captures it, that the answer is over what is in view. `LIVE=1` asks the model instead; `LIVE=1 RECORD=1` asks it and,
 * once every check has passed, keeps what it said as the recording.
 */
demo("snb-ask", "Ask over LDBC SNB: filter the page, ask about it, and add the answer to the dashboard", {
  async arrange({ page, env }) {
    const replay = await model(page, "snb-ask");
    const id = await seedGraph(page, "snb", { name: "Demo · LDBC Social Network", reuse: true });
    // Opened on the dashboard with Ask docked: the Graph view would lay out 327K nodes first.
    const discover = await DiscoverPage.open(page, env, id, { view: "dashboard", panel: "ask" });
    await discover.relation("Person");
    const dashboard = await discover.dashboard();
    const ask = await discover.ask();
    if (replay.live) await ask.warmUp();
    const answers = await ask.composer();
    return { replay, discover, dashboard, ask, answers, answered: { tile: undefined as TileHarness | undefined } };
  },

  steps: ({ replay, discover, dashboard, ask, answers, answered }) => [
    {
      subtitle: "Filter the page: women only",
      action: async () => (await (await dashboard.tile("Count by Person.gender")).chart()).pick({ y: "female" }),
      check: () => expect.poll(() => discover.figure("Rows")).toBe("778"),
    },
    {
      subtitle: "Ask about what's in view, in plain words",
      // Resolves once a new answer card has begun.
      action: () => answers.ask(QUESTION),
      check: async () => expect(replay.unrecorded, "model calls the recording does not hold: capture it again").toEqual([]),
    },
    {
      subtitle: "The answer is a chart, over the women in view",
      action: async () => (answered.tile = await answers.answer()),
      async check() {
        expect(await answered.tile!.text()).toContain("Firefox");
        // A chart draws its bars, not their figures: the figures are in the reply, which the model
        // writes from the tool's result. 324 of the women; 628 would be everyone's — an answer that
        // dropped the page's filter.
        const reply = await ask.host.text();
        expect(reply).toContain("324");
        expect(reply).not.toContain("628");
      },
      poster: true,
    },
    {
      subtitle: "Add it to the dashboard",
      // Resolves on the card's *✓ On the dashboard*, read from the dashboards the page handed back.
      action: () => answers.addToDashboard(),
      check: async () => void (await dashboard.tile(/browserUsed/)),
    },
  ],

  // Only a take whose every check passed is kept as the recording (LIVE=1 RECORD=1).
  passed: ({ replay }) => replay.keep(),
});
