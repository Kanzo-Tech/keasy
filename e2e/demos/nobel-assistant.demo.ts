import { expect, type Page } from "@playwright/test";
import type { ModelTurn } from "@kanzo-tech/testing";

import { AskPanel } from "../support/app";
import { chooseRadio } from "../support/app/controls";
import { promptsOf, scriptModel } from "../support/model";
import { demo } from "./record";

/** The Nobel example's connection, as the dev stack names it, and its six files. */
const CONNECTION = "Nobel laureates";
const FILES = ["laureates", "awards", "categories", "institutions", "affiliations", "countries"];

const ABOUT = "Nobel prizes: who won them, in what, and where they worked";

/** The decision with no safe default, and the answer the demo gives it. */
const LINK = "Each row of affiliations links award to institution. Is a row only that link, or a thing counted on its own?";
const ONE = "Only a link: award → institution";
/** The decision a safe default settled — a country by its id — and the one the demo changes it to. */
const COUNTRY = "Which column tells one country from another?";

const BY_CATEGORY = "How many prizes were awarded in each category?";
const BY_INSTITUTION = "Which institutions are behind the most prizes?";

/**
 * What the model proposes over the Nobel files: a type per thing, each on the file and key the profile
 * offers, the awards linked to their laureate and category, and to their institutions across
 * `affiliations` — which raises the one decision with no safe default. Countries stand alone, so which
 * of their two keys identifies one is a default, said as an assumption.
 */
const DRAFT = {
  types: [
    { name: "Laureate", source: "laureates", key: "id", fields: [{ name: "name", column: "name" }, { name: "gender", column: "gender" }] },
    { name: "Award", source: "awards", key: "id", fields: [{ name: "year", column: "year" }, { name: "share", column: "share" }] },
    { name: "Category", source: "categories", key: "id", fields: [{ name: "name", column: "name" }] },
    { name: "Institution", source: "institutions", key: "id", fields: [{ name: "name", column: "name" }, { name: "city", column: "city" }] },
    { name: "Country", source: "countries", key: "id", fields: [{ name: "name", column: "name" }] },
  ],
  edges: [
    { name: "laureate", from: "Award", to: "Laureate", via: "awards.laureate → laureates.id" },
    { name: "category", from: "Award", to: "Category", via: "awards.category → categories.id" },
    { name: "institution", from: "Award", to: "Institution", via: "affiliations.institution → institutions.id" },
  ],
};

/** The questions the model suggests: three chips, two of which the demo takes. */
const REQUIREMENTS = {
  elements: [
    { text: BY_CATEGORY, of: "Award", fields: ["Award.category", "Category.name"] },
    { text: BY_INSTITUTION, of: "Award", fields: ["Award.institution", "Institution.name"] },
    { text: "How many laureates are women?", of: "Laureate", fields: ["Laureate.gender"] },
  ],
};

/**
 * The mappings the model writes, each `@subject` the one keasy computes under the page's origin; a
 * country identified by `countryKey`. Held against fossil's checker over the real Nobel profile when
 * this demo was written: one attempt, no diagnostic.
 */
function mappings(origin: string, countryKey: "id" | "name"): string {
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
    @subject = ${id("country", `countries.${countryKey}`)}
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
 * Task's instructions (`web/…/assistant/tasks/`), the `mapping` Task's — the country's subject telling
 * the program written after the decision changed from the first — and Ask's, per question. The second
 * question's prompt carries the first, so it is looked for first.
 */
function script(origin: string): ModelTurn[] {
  const json = (value: unknown) => ({ text: JSON.stringify(value) });
  return [
    { when: "You design what a person's data is about", reply: json(DRAFT) },
    { when: "You suggest questions a person could ask", reply: json(REQUIREMENTS) },
    { when: "{countries.name}", reply: { text: mappings(origin, "name") } },
    { when: "You write the mappings of a Fossil program", reply: { text: mappings(origin, "id") } },
    {
      when: `Question: ${BY_INSTITUTION}`,
      reply: json({ spec: { of: "Award", show: { kind: "chart", type: "bar", x: "Institution.name", y: { op: "count" } } } }),
    },
    {
      when: `Question: ${BY_CATEGORY}`,
      reply: json({ spec: { of: "Award", show: { kind: "chart", type: "bar", x: "Category.name", y: { op: "count" } } } }),
    },
  ];
}

/** How fast the double answers: a beat before the first word, then a short one a word. */
const PACE = { wait: 1_200, perWord: 25 };

/** The connection's pill above the composer: *+ @Nobel laureates*, then *@Nobel laureates · 6 files*. */
const pill = (page: Page) => page.locator(`[data-connection="${CONNECTION}"]`).getByRole("button", { name: `@${CONNECTION}` });

/** The preview's answers, once each kept question has its card and none is being replaced. */
async function answered(page: Page): Promise<number> {
  const answers = page.locator("[data-preview-answers]");
  if ((await page.locator("[data-stale]").count()) > 0) return -1;
  return answers.locator('[data-slot="answer-card"]').count();
}

/**
 * The guided assistant over the Nobel example, as one thread, from the files to Ask: the files picked on
 * the connection's pill above the composer (*Select all*), what they are about typed and sent with them,
 * the steps it says it takes (*What I am doing*), what is in them, the one decision with no safe answer
 * answered, an assumption shown and changed through its *Change*, two of the questions on offer taken,
 * the preview answering them in the thread over the first 200 rows, then the whole graph built (*Build
 * the graph*) and asked in Discover.
 *
 * The model is a double (`support/model.ts`), as the e2e suite's is: the assistant's Tasks are three
 * calls and a mapping written to fossil's grammar, and a recording that depended on a small model
 * proposing the same types on every take would be a different film. Everything else is the stack's: the
 * profile is fossil's over the files in the store, the program is checked by fossil, the preview and the
 * build are runs on the page's engine, and every answer is read from the graph.
 *
 * Written against `web/…/assistant/` (`source-bar.tsx`, `turns.tsx`, `steps.ts`) without a browser to
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
      // The details are pinned above the thread once the first message is sent.
      check: () => expect(page.locator("[data-details]")).toContainText(ABOUT),
    },
    {
      subtitle: "What I am doing, step by step",
      action: () => page.getByRole("list", { name: "What I am doing" }).first().scrollIntoViewIfNeeded(),
      check: () => expect(page.getByRole("list", { name: "What I am doing" }).first()).toContainText("Proposed the types", { timeout: 60_000 }),
    },
    {
      subtitle: "What is in your data",
      action: () => expect(page.getByText("Here’s what’s in your data")).toBeVisible({ timeout: 60_000 }),
      check: () => expect(page.locator("[data-things] > li")).toHaveCount(FILES.length),
    },
    {
      subtitle: "What has no safe answer is yours to decide",
      action: () => chooseRadio(env, env.rootElement, LINK, ONE),
      check: () => expect(page.getByRole("radiogroup", { name: LINK }).getByRole("radio", { name: ONE })).toBeChecked(),
    },
    {
      subtitle: "What has a safe default is taken, and said",
      action: () => page.locator('[data-assumption="key/countries"]').scrollIntoViewIfNeeded(),
      check: () => expect(page.locator('[data-assumption="key/countries"]')).toContainText("I assumed: id"),
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
      subtitle: "That's all: show me a preview",
      action: () => page.getByRole("button", { name: "That's all, show me a preview" }).click(),
      check: () => expect(page.getByText("Here is your data over its first 200 rows")).toBeVisible({ timeout: 60_000 }),
    },
    {
      subtitle: "Each question answered, over the first 200 rows",
      action: () => page.locator("[data-preview-answers]").scrollIntoViewIfNeeded(),
      check: () => expect.poll(() => answered(page), { timeout: 60_000 }).toBe(2),
      poster: true,
    },
    {
      subtitle: "Change an assumption: the preview runs again",
      async action() {
        // The assumption's one door to its options.
        await page.locator('[data-decision="key/countries"]').getByRole("button", { name: "Change" }).click();
        await page.getByRole("radiogroup", { name: COUNTRY }).scrollIntoViewIfNeeded();
        await chooseRadio(env, env.rootElement, COUNTRY, "name");
      },
      async check() {
        // The program written again, for the country's other key, and the answers read over it.
        await expect.poll(async () => (await promptsOf(page)).some((p) => p.includes("{countries.name}")), { timeout: 60_000 }).toBe(true);
        await page.locator("[data-preview-answers]").scrollIntoViewIfNeeded();
        await expect.poll(() => answered(page), { timeout: 60_000 }).toBe(2);
      },
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
