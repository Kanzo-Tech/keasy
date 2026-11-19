import { expect, type Page } from "@playwright/test";
import type { ModelTurn } from "@kanzo-tech/testing";

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

const BY_CATEGORY = "How many prizes were awarded in each category?";
const BY_INSTITUTION = "Which institutions are behind the most prizes?";

/**
 * What the model names over the Nobel files. The structure is the profile's: a thing per file with a
 * key, the awards linked to their laureate and category, and to their institutions across
 * `affiliations` — which raises the one decision with no safe default. A field left unnamed keeps its
 * column's name.
 */
const NAMES = {
  types: { laureates: "Laureate", awards: "Award", categories: "Category", institutions: "Institution", countries: "Country" },
  edges: {
    "awards.laureate → laureates.id": "laureate",
    "awards.category → categories.id": "category",
    "affiliations.institution → institutions.id": "institution",
    "laureates.country → countries.id": "country",
  },
  fields: {},
};

/** The questions the model suggests: three chips, two of which the demo takes. */
const REQUIREMENTS = {
  elements: [
    { text: BY_CATEGORY, of: "Award", fields: ["category.name"] },
    { text: BY_INSTITUTION, of: "Award", fields: ["institution.name"] },
    { text: "How many laureates are women?", of: "Laureate", fields: ["gender"] },
  ],
};

/**
 * The mappings the model writes, each `@subject` the one keasy computes under the page's origin. Held
 * against fossil's checker over the real Nobel profile when this demo was written: one attempt, no
 * diagnostic.
 */
function mappings(origin: string): string {
  const id = (type: string, column: string) => `"${origin}/id/${type}/{${column}}"`;
  return `Laureates : Laureate from laureates
    @subject = ${id("laureate", "laureates.id")}
    name = laureates.name
    gender = laureates.gender

Awards : Award from awards
    @subject = ${id("award", "awards.id")}
    year = awards.year
    share = awards.share
    laureate = Laureate(awards.laureate)
    category = Category(awards.category)

Categories : Category from categories
    @subject = ${id("category", "categories.id")}
    name = categories.name

Institutions : Institution from institutions
    @subject = ${id("institution", "institutions.id")}
    name = institutions.name
    city = institutions.city

Countries : Country from countries
    @subject = ${id("country", "countries.id")}
    name = countries.name

Affiliations : Award from awards.join(affiliations, on = awards.id == affiliations.award)
    @subject = ${id("award", "awards.id")}
    year = awards.year
    share = awards.share
    laureate = Laureate(awards.laureate)
    category = Category(awards.category)
    institution = Institution(affiliations.institution)
`;
}

/**
 * Every call of the flow, by the words its prompt carries: the `model` Task's and the `requirements`
 * Task's instructions (`web/…/assistant/tasks/`), the `mapping` Task's, and Ask's, per question. The
 * second question's prompt carries the first, so it is looked for first.
 */
function script(origin: string): ModelTurn[] {
  const json = (value: unknown) => ({ text: JSON.stringify(value) });
  return [
    { when: "You design what a person's data is about", reply: json(NAMES) },
    { when: "You suggest questions a person could ask", reply: json(REQUIREMENTS) },
    { when: "You write the mappings of a Fossil program", reply: { text: mappings(origin) } },
    {
      when: `Question: ${BY_INSTITUTION}`,
      reply: json({ spec: { of: "Award", show: { kind: "chart", type: "bar", x: "institution.name", y: { op: "count" } } } }),
    },
    {
      when: `Question: ${BY_CATEGORY}`,
      reply: json({ spec: { of: "Award", show: { kind: "chart", type: "bar", x: "category.name", y: { op: "count" } } } }),
    },
  ];
}

/** How fast the double answers: a beat before the first word, then a short one a word. */
const PACE = { wait: 1_200, perWord: 25 };

/** The connection's pill above the composer: *+ @Nobel laureates*, then *@Nobel laureates · 6 files*. */
const pill = (page: Page) => page.locator(`[data-connection="${CONNECTION}"]`).getByRole("button", { name: new RegExp(`^@${CONNECTION}`) });

/** The preview's answers, once each kept question has its card and none is being replaced. */
async function answered(page: Page): Promise<number> {
  const answers = page.locator("[data-preview-answers]");
  if ((await page.locator("[data-stale]").count()) > 0) return -1;
  return answers.locator('[data-slot="answer-card"]').count();
}

/**
 * The guided assistant over the Nobel example, as one thread, from the files to Ask: the files picked on
 * the connection's pill above the composer (*Select all*), what they are about typed and sent with them,
 * what is in them under the panel's *Data*, two of the questions on offer taken and answered under its
 * *Preview* over the first 200 rows while the one decision with no safe answer is still open, that
 * decision answered, then the whole graph built (*Build the graph*) and asked in Discover.
 *
 * The model is a double (`support/model.ts`), as the e2e suite's is: the assistant's Tasks are three
 * calls and a mapping written to fossil's grammar, and a recording that depended on a small model
 * proposing the same types on every take would be a different film. Everything else is the stack's: the
 * profile is fossil's over the files in the store, the program is checked by fossil, the preview and the
 * build are runs on the page's engine, and every answer is read from the graph.
 *
 * Written against `web/…/assistant/` (`source-bar.tsx`, `turns.tsx`, `panel.tsx`) without a browser to
 * run it in: the selectors below are read from those components, not observed.
 */
demo("nobel-assistant", "The guided assistant: the Nobel files to a preview in the chat, a graph built, then Ask", {
  // The composer is at the bottom of the chat.
  subtitles: "top",
  async arrange({ page }) {
    // The subjects are under the page's origin: read it, then put the double on the next load.
    await page.goto("/graphs");
    const origin = new URL(page.url()).origin;
    // At a model's pace, so each turn arrives on camera rather than all at once.
    await scriptModel(page, { turns: script(origin), pace: PACE });
    await page.goto("/graphs/new/assistant");
    // The connection is a pill above the composer's field, before anything is picked.
    await expect(pill(page)).toBeVisible();
    return { page };
  },

  steps: ({ page }, { env }) => [
    {
      subtitle: "Pick the files on the composer",
      async action() {
        // The pill opens a menu of what the connection lists; it stays open while files are ticked.
        await pill(page).click();
        await page.getByRole("menuitem", { name: "Select all" }).click();
        await page.keyboard.press("Escape");
      },
      check: () => expect(pill(page)).toContainText(`${FILES.length} files`),
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
        await page.getByRole("button", { name: BY_INSTITUTION }).click();
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
