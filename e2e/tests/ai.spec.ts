import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { HarnessEnvironment } from "@kanzo-tech/testing";

import { api, SOURCE } from "../support/stack/api";
import { DiscoverPage } from "../support/app";
import { test } from "../support/fixtures";
import { promptsOf, useModelDouble } from "../support/model";
import { expectProblem } from "../support/stack/problem";

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

/** The new-graph wizard's Requirements step, asked over the suite's source. */
async function askForRequirements(page: Page) {
  await page.goto("/graphs/new");
  await page.getByText("Assistant", { exact: true }).click();
  // Ark draws the checkbox's control over its input, so it is ticked from the keyboard, as a reader
  // without a pointer ticks it, rather than clicked through the control.
  const source = page.getByRole("checkbox", { name: `Select ${SOURCE}` });
  await source.focus();
  await source.press("Space");
  await expect(source).toBeChecked();
  // In the dev stack TanStack's devtools button floats over the footer's corner.
  await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
  // Continue waits for the schemas, then asks for requirements on the Requirements screen.
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 60_000 });
}

/** The wizard's call for requirements, by its system prompt. */
const REQUIREMENTS = "Competency questions define the scope";

test("11 a browser without WebGPU fails the answer in Ask as ai/unavailable", async ({ page, env, corpusGraph }) => {
  await withoutWebGPU(page);
  await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
  // Said at once, by its code, rather than a load that never finishes.
  await expectProblem(page, "ai/unavailable", { within: 15_000 });
});

test("12 the shards of the model cannot be downloaded: Ask says so, not an empty answer", async ({ page, env, corpusGraph }) => {
  // WebLLM's words for a shard the origin does not serve; a call after a failed load fails the same way.
  const fail = "Cannot fetch http://acme.localhost:3000/models/Qwen3-4B-q4f16_1-MLC/resolve/a5c9fab/params_shard_0.bin";
  await useModelDouble(page, { load: { fail }, rules: [{ when: question("How many people are there?"), reply: { fail } }] });
  const panel = await askPanel(page, env, corpusGraph);
  // The load began as the graph opened, and its failure is in the panel before anything is asked.
  await expectProblem(page, "llm/failed", { within: 15_000 });
  await panel.send("How many people are there?");
  await expect(page.locator('[data-slot="chat-error"] [data-code="llm/failed"]')).toBeVisible({ timeout: 15_000 });
});

test("13 a model that stops writing mid-answer can be stopped, and the next question is answered", async ({ page, env, corpusGraph }) => {
  const words = "How many people are there?";
  await useModelDouble(page, {
    rules: [
      { when: question(words), reply: { hang: true }, once: true },
      { when: question(words), reply: { text: JSON.stringify({ of: "Person", show: { kind: "stat", measure: { op: "count" } } }) } },
    ],
  });
  const panel = await askPanel(page, env, corpusGraph);
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
  // One whole requirement, then the engine fails: what was written is not taken for the whole answer.
  const one = JSON.stringify({ text: "Who bought the most?", rationale: "Orders.person_id" });
  await useModelDouble(page, {
    rules: [{ when: REQUIREMENTS, reply: { after: `{"elements":[${one},{"text":"How many`, fail: "The GPU device was lost" } }],
  });
  await askForRequirements(page);
  await expectProblem(page, "llm/failed", { within: 20_000 });
});

test("15 a structured answer that does not parse fails the step of the assistant, not as no suggestions", async ({ page }) => {
  // Suggesting requirements asks for JSON; prose instead fails the call, and says so.
  await useModelDouble(page, { rules: [{ when: REQUIREMENTS, reply: { text: "You should look at the people table." } }] });
  await askForRequirements(page);
  await expectProblem(page, "llm/failed", { within: 20_000 });
});

test("16 an answer the spec does not admit is refused in the reply, and the model reads why", async ({ page, env, corpusGraph }) => {
  // The model names a field Person does not have, every time it is asked: the spec is checked before
  // anything runs, sent back with the check's own words, and refused once the attempts are spent.
  const words = "How many people wear a 42?";
  const spec = { of: "Person", where: [{ field: "Person.shoeSize", in: ["42"] }], show: { kind: "stat", measure: { op: "count" } } };
  await useModelDouble(page, { rules: [{ when: question(words), reply: { text: JSON.stringify(spec) } }] });
  await (await askPanel(page, env, corpusGraph)).send(words);
  await expect(page.getByText(/I could not answer that over this data: .*Person\.shoeSize is not a field of Person/)).toBeVisible({
    timeout: 15_000,
  });
  // No card: nothing was read on the engine.
  await expect(page.locator('[data-slot="answer-card"]')).toHaveCount(0);
  const asked = (await promptsOf(page)).filter((prompt) => prompt.includes(question(words)));
  expect(asked.length).toBeGreaterThan(1);
  expect(asked[1]).toMatch(/It does not hold:[\s\S]*Person\.shoeSize is not a field of Person/);
});

test("the assistant on a browser without WebGPU fails its step as ai/unavailable, not as no suggestions", async ({ page }) => {
  await withoutWebGPU(page);
  await askForRequirements(page);
  await expectProblem(page, "ai/unavailable", { within: 20_000 });
});

test("an answer added to the dashboard is saved as a tile of its relation", async ({ page, env, corpusGraph }) => {
  const title = `Asked ${Date.now()}`;
  const words = "How many people are there?";
  await useModelDouble(page, {
    rules: [{ when: question(words), reply: { text: JSON.stringify({ of: "Person", show: { kind: "stat", measure: { op: "count" }, title } }) } }],
  });
  const answers = await (await askPanel(page, env, corpusGraph)).composer();
  await answers.ask(words);
  // The figure is proven from the engine's result, against the fixture it was read from.
  expect(await answers.rows()).toEqual([{ count: String(PEOPLE) }]);
  // Resolves on the card's own *Open on the dashboard*, read from the dashboards the page handed back.
  await answers.addToDashboard();
  // Written at once, not after the editor's pause: an addition is a decision, not typing.
  await expect
    .poll(async () => JSON.stringify((await api(page, "GET", `/v1/graphs/${corpusGraph}/dashboard`)).body), { timeout: 10_000 })
    .toContain(title);
});
