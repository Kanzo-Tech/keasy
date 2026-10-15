import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { HarnessEnvironment } from "@kanzo-tech/testing";

import { api, SOURCE } from "../support/stack/api";
import { AskPanel, DiscoverPage } from "../support/app";
import { test } from "../support/fixtures";
import { promptsOf, scriptModel } from "../support/model";
import { expectModelProblem, expectProblem } from "../support/stack/problem";

/**
 * The model runs in the page, on WebGPU (`web/src/lib/ai.ts`). Scenario 11 forces a browser without
 * it — `navigator.gpu` gone before the page loads, so `localModel` refuses before anything is
 * downloaded. The rest put a model double in the page (`support/model.ts`), which answers, fails or
 * goes silent as each scenario scripts, because CI's Chromium has no WebGPU to run the real one on.
 */
const withoutWebGPU = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get: () => undefined }));

/** The graph's Ask panel, docked from the URL. */
const askPanel = async (page: Page, env: HarnessEnvironment, graphId: string) =>
  (await DiscoverPage.open(page, env, graphId, { panel: "ask" })).ask();

/** The prompt of Ask's Task for `question`: what a rule answers it by. */
const question = (words: string) => `Question: ${words}`;

/** The rows of the people fixture: what a count of Person reads. */
const PEOPLE = readFileSync(new URL("../fixtures/data/people.csv", import.meta.url), "utf8").trim().split("\n").length - 1;

/**
 * The `model` Task's call and the `requirements` Task's, by their instructions' first words
 * (`web/…/assistant/tasks/model.ts` and `requirements.ts`).
 */
const MODEL = "You design what a person's data is about";
const REQUIREMENTS = "You suggest questions a person could ask";

/** What the model proposes over the people fixture: one type, which raises no decision that blocks. */
const PERSON = {
  types: [{ name: "Person", source: "people", key: "person_id", fields: [{ name: "name", column: "name" }, { name: "city", column: "city" }] }],
  edges: [],
};

/**
 * The guided chat's questions turn, over the suite's source: the people file picked in the tree and
 * read, *what is it about?* skipped, and the types the double proposes accepted — where the
 * `requirements` Task is asked for its chips.
 */
async function askForRequirements(page: Page) {
  await page.goto("/graphs/new");
  await page.getByText("Assistant", { exact: true }).click();
  await expect(page).toHaveURL(/\/graphs\/new\/assistant$/);
  // In the dev stack TanStack's devtools button floats over the chat's corner.
  await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
  // The connection is listed when it is opened; its files have a box only then.
  await page.getByRole("tree", { name: "Files" }).getByText(`@${SOURCE}`, { exact: true }).click();
  // The tree's own box: Space on a row selects it, so the box is pressed.
  const file = page.getByRole("checkbox", { name: "Pick people.csv" });
  await file.click();
  await expect(file).toBeChecked();
  await page.getByRole("button", { name: "Read this file" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  // The profile is read on the page's engine, then the double's types are accepted.
  await expect(page.getByText("What would you like to know?")).toBeVisible({ timeout: 60_000 });
}

/** The failure is the questions turn's: the `requirements` Task's, said where the chat stopped. */
async function failedOnQuestions(page: Page) {
  await expect(page.locator('[data-task="requirements"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Who bought the most?" })).toHaveCount(0);
}

test("11 a browser without WebGPU fails the answer in Ask as llm/unavailable", async ({ page, env, builtGraph }) => {
  await withoutWebGPU(page);
  await (await askPanel(page, env, builtGraph)).send("How many people are there?");
  // Said at once, by its code, rather than a load that never finishes.
  await expectProblem(page, "llm/unavailable", { within: 15_000 });
});

test("12 the shards of the model cannot be downloaded: Ask says so, not an empty answer", async ({ page, env, builtGraph }) => {
  // WebLLM's words for a shard the origin does not serve; a call after a failed load fails the same way.
  const fail = "Cannot fetch http://acme.localhost:3000/models/Qwen3-4B-q4f16_1-MLC/resolve/a5c9fab/params_shard_0.bin";
  await scriptModel(page, { load: { fail }, turns: [{ when: question("How many people are there?"), reply: { fail } }] });
  const panel = await askPanel(page, env, builtGraph);
  // The load began as the graph opened, and its failure is the panel's badge before anything is asked.
  await expectModelProblem(page, "llm/failed", { within: 15_000 });
  await panel.send("How many people are there?");
  await expect(page.locator('[data-slot="chat-error"] [data-code="llm/failed"]')).toBeVisible({ timeout: 15_000 });
});

test("13 a model that stops writing mid-answer can be stopped, and the next question is answered", async ({ page, env, builtGraph }) => {
  const words = "How many people are there?";
  await scriptModel(page, {
    turns: [
      { when: question(words), reply: { hang: true }, once: true },
      { when: question(words), reply: { text: JSON.stringify({ spec: { of: "Person", show: { kind: "stat", measure: { op: "count" } } } }) } },
    ],
  });
  const panel = await askPanel(page, env, builtGraph);
  await panel.send(words);
  // Nothing bounds a model in the page but the person: the answer waits until they stop it.
  const stop = page.getByRole("complementary", { name: "Ask panel" }).getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible({ timeout: 15_000 });
  await stop.click();
  await expect(stop).toBeHidden();
  const answers = await panel.composer();
  await answers.ask(words);
  expect(await answers.rows()).toEqual([{ count: String(PEOPLE) }]);
});

test("14 a model that fails mid-answer is a failure, not a short answer", async ({ page }) => {
  // One whole question, then the engine fails: what was written is not taken for the whole list.
  const one = JSON.stringify({ text: "Who bought the most?", of: "Person", fields: ["Person.name"] });
  await scriptModel(page, {
    turns: [
      { when: MODEL, reply: { text: JSON.stringify(PERSON) } },
      { when: REQUIREMENTS, reply: { after: `{"elements":[${one},{"text":"How many`, fail: "The GPU device was lost" } },
    ],
  });
  await askForRequirements(page);
  await expectProblem(page, "llm/failed", { within: 20_000 });
  await failedOnQuestions(page);
});

test("15 a structured answer that does not parse fails the step of the assistant, not as no suggestions", async ({ page }) => {
  // The questions are asked for as JSON; prose instead fails the call, and says so.
  await scriptModel(page, {
    turns: [
      { when: MODEL, reply: { text: JSON.stringify(PERSON) } },
      { when: REQUIREMENTS, reply: { text: "You should look at the people table." } },
    ],
  });
  await askForRequirements(page);
  await expectProblem(page, "llm/failed", { within: 20_000 });
  await failedOnQuestions(page);
});

test("16 an answer the spec does not admit is refused in the reply, and the model reads why", async ({ page, env, builtGraph }) => {
  // The model names a field Person does not have, every time it is asked: the spec is checked before
  // anything runs, sent back with the check's own words, and refused once the attempts are spent.
  const words = "How many people wear a 42?";
  const spec = { of: "Person", where: [{ field: "Person.shoeSize", in: ["42"] }], show: { kind: "stat", measure: { op: "count" } } };
  await scriptModel(page, { turns: [{ when: question(words), reply: { text: JSON.stringify({ spec }) } }] });
  await (await askPanel(page, env, builtGraph)).send(words);
  await expect(page.getByText(/I could not answer that over this data: .*Person\.shoeSize is not a field of Person/)).toBeVisible({
    timeout: 15_000,
  });
  // No card: nothing was read on the engine.
  await expect(page.locator('[data-slot="answer-card"]')).toHaveCount(0);
  const asked = (await promptsOf(page)).filter((prompt) => prompt.includes(question(words)));
  expect(asked.length).toBeGreaterThan(1);
  expect(asked[1]).toMatch(/It does not hold:[\s\S]*Person\.shoeSize is not a field of Person/);
});

test("the assistant on a browser without WebGPU says so as llm/unavailable, not as no suggestions", async ({ page }) => {
  await withoutWebGPU(page);
  await page.goto("/graphs/new");
  await page.getByText("Assistant", { exact: true }).click();
  await expect(page).toHaveURL(/\/graphs\/new\/assistant$/);
  await expectModelProblem(page, "llm/unavailable", { within: 20_000 });
});

test("an answer added to the dashboard is saved as a tile of its relation", async ({ page, env, builtGraph }) => {
  const title = `Asked ${Date.now()}`;
  const words = "How many people are there?";
  await scriptModel(page, {
    turns: [{ when: question(words), reply: { text: JSON.stringify({ spec: { of: "Person", show: { kind: "stat", measure: { op: "count" }, title } } }) } }],
  });
  const answers = await (await askPanel(page, env, builtGraph)).composer();
  await answers.ask(words);
  // The figure is proven from the engine's result, against the fixture it was read from.
  expect(await answers.rows()).toEqual([{ count: String(PEOPLE) }]);
  // Resolves on the card's own *Open on the dashboard*, read from the dashboards the page handed back.
  await answers.addToDashboard();
  // Written at once, not after the editor's pause: an addition is a decision, not typing.
  await expect
    .poll(async () => JSON.stringify((await api(page).GET("/v1/graphs/{id}/dashboard", { params: { path: { id: builtGraph } } })).data), {
      timeout: 10_000,
    })
    .toContain(title);
});

test("the assistant's question reaches Ask once: asked as Discover opens, not again on a refresh", async ({ page, env, builtGraph }) => {
  const words = "How many people are there?";
  await scriptModel(page, {
    turns: [{ when: question(words), reply: { text: JSON.stringify({ spec: { of: "Person", show: { kind: "stat", measure: { op: "count" } } } }) } }],
  });
  // What the assistant's last turn links to: Ask docked, the person's question handed over.
  await page.goto(`/graphs/${builtGraph}/discover?panel=ask&q=${encodeURIComponent(words)}`);
  const ask = await env.getHarness(AskPanel);
  await ask.warmUp();
  const answers = await ask.composer();
  expect(await answers.rows()).toEqual([{ count: String(PEOPLE) }]);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  expect((await promptsOf(page)).filter((prompt) => prompt.includes(question(words)))).toHaveLength(1);

  // The question left the URL as it was sent: the page opened again asks nothing.
  await page.reload();
  await (await env.getHarness(AskPanel)).warmUp();
  expect((await promptsOf(page)).filter((prompt) => prompt.includes(question(words)))).toHaveLength(0);
});
