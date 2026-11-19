import { expect, type Page } from "@playwright/test";

import { AskPanel } from "../support/app";
import { chooseRadio } from "../support/app/controls";
import { scriptModel } from "../support/model";
import { demo } from "./record";

/** The Nobel example's connection, as the dev stack names it, and its six files. */
const CONNECTION = "Nobel laureates";
const FILES = ["laureates", "awards", "categories", "institutions", "affiliations", "countries"];

const ABOUT = "Nobel prizes: who won them, in what, and where they worked";

/** The decision with no safe default, and the answer the demo gives it. */
const LINK = "Each row of affiliations links award to institution. Is a row only that link, or a thing counted on its own?";
const ONE = "Only a link: award → institution";

/** Two of the questions on offer, written from the model as Ask's specs (`offersOf`): asked with no model. */
const BY_CATEGORY = "Award count by category";
const BY_LAUREATE = "Award count by laureate";

/** How fast the double answers: a beat before the first word, then a short one a word. */
const PACE = { wait: 1_200, perWord: 25 };

/** The composer's +, which lists the connections and then a connection's files. */
const plus = (page: Page) => page.getByRole("button", { name: "Add files" });

/** The preview's answers, once each kept question has its card and none is being replaced. */
async function answered(page: Page): Promise<number> {
  const answers = page.locator("[data-preview-answers]");
  if ((await page.locator("[data-stale]").count()) > 0) return -1;
  return answers.locator('[data-slot="answer-card"]').count();
}

/**
 * The guided assistant over the Nobel example, as one thread, from the files to Ask: the files picked on
 * the composer's + (*Select all* in the connection's files), what they are about typed and sent with them,
 * what is in them under the panel's *Data*, two of the questions on offer taken and answered under its
 * *Preview* over the first 200 rows while the one decision with no safe answer is still open, that
 * decision answered, then the whole graph built (*Build the graph*) and asked in Discover.
 *
 * The model is a double (`support/model.ts`), as the e2e suite's is, and nothing here asks it: the
 * names, the program and the questions on offer are written from fossil's profile, and a question
 * taken from the offer is asked as its spec. Everything else is
 * the stack's: the profile is fossil's over the files in the store, the program is checked by fossil,
 * the preview and the build are runs on the page's engine, and every answer is read from the graph.
 *
 * Written against `web/…/assistant/` (`source-bar.tsx`, `turns.tsx`, `panel.tsx`) without a browser to
 * run it in: the selectors below are read from those components, not observed.
 */
demo("nobel-assistant", "The guided assistant: the Nobel files to a preview in the chat, a graph built, then Ask", {
  // The composer is at the bottom of the chat.
  subtitles: "top",
  async arrange({ page }) {
    // The double goes on the next load.
    await page.goto("/graphs");
    // At a model's pace, so each turn arrives on camera rather than all at once.
    await scriptModel(page, { turns: [], pace: PACE });
    await page.goto("/graphs/new/assistant");
    // The composer's +, before anything is picked.
    await expect(plus(page)).toBeVisible();
    return { page };
  },

  steps: ({ page }, { env }) => [
    {
      subtitle: "Pick the files on the composer",
      async action() {
        // The + lists the connections; the connection opens to its files, and stays open while they are picked.
        await plus(page).click();
        await page.getByRole("menuitem", { name: CONNECTION, exact: true }).click();
        await page.getByRole("menuitemcheckbox", { name: "Select all" }).click();
        await page.keyboard.press("Escape");
      },
      // Three cards, then the rest of the connection as one.
      check: () => expect(page.locator("[data-file-card]").last()).toContainText(`+${FILES.length - 3} more files`),
    },
    {
      subtitle: "Say what it is about, and send",
      async action() {
        const about = page.getByRole("textbox", { name: "What is this data about?" });
        await about.pressSequentially(ABOUT, { delay: 25 });
        await about.press("Enter");
      },
      // The first message is the files and what they are about; the panel opens beside it.
      check: () => expect(page.locator("[data-reply]").first()).toContainText(ABOUT),
    },
    {
      subtitle: "What is in your data, beside the conversation",
      action: () => expect(page.getByRole("complementary", { name: "Your graph" })).toBeVisible(),
      check: () => expect(page.locator("[data-things] > li")).toHaveCount(FILES.length, { timeout: 60_000 }),
    },
    {
      subtitle: "Take the questions it suggests",
      async action() {
        await page.getByRole("button", { name: BY_CATEGORY }).click();
        await page.getByRole("button", { name: BY_LAUREATE }).click();
      },
      check: () => expect(page.locator("[data-question]")).toHaveCount(2),
    },
    {
      subtitle: "Each question answered over the first 200 rows, with nothing decided yet",
      action: () => expect(page.locator("[data-checkpoint]")).toBeVisible({ timeout: 60_000 }),
      check: () => expect.poll(() => answered(page), { timeout: 60_000 }).toBe(2),
      poster: true,
    },
    {
      subtitle: "Only the build waits on what has no safe answer",
      action: () => expect(page.locator("[data-waits]")).toContainText("1 question with no safe answer"),
      check: () => expect(page.getByRole("button", { name: "Build the graph" })).toBeDisabled(),
    },
    {
      subtitle: "Decide it",
      action: () => chooseRadio(env, env.rootElement, LINK, ONE),
      check: () => expect(page.getByRole("button", { name: "Build the graph" })).toBeEnabled(),
    },
    {
      subtitle: "Build the graph",
      action: () => page.getByRole("button", { name: "Build the graph" }).click(),
      check: () => expect(page.getByText("Your graph is ready to explore.")).toBeVisible({ timeout: 120_000 }),
    },
    {
      subtitle: "Ask your data, in Discover",
      action: () => page.getByRole("link", { name: "Ask your data" }).click(),
      async check() {
        await expect(page).toHaveURL(/\/graphs\/[^/]+\/discover/);
        await env.getHarness(AskPanel);
      },
    },
  ],
});
