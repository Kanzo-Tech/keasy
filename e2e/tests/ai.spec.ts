import { expect, type Page } from "@playwright/test";
import type { HarnessEnvironment } from "@kanzo-tech/testing";

import { SOURCE } from "../support/stack/api";
import { DiscoverPage } from "../support/app";
import { test } from "../support/fixtures";
import { expectProblem } from "../support/stack/problem";

/**
 * The model runs in the page, on WebGPU (`web/src/lib/ai.ts`). What these scenarios can force without
 * a GPU is a browser that has none, as most of Linux and Android outside Chrome have none: its
 * `navigator.gpu` gone before the page loads, so `localModel` refuses before anything is downloaded.
 * The rest wait on a model double in the page — a route on the network no longer reaches the model.
 */
const withoutWebGPU = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { configurable: true, get: () => undefined }));

/** The graph's Ask panel, docked from the URL. */
const askPanel = async (page: Page, env: HarnessEnvironment, graphId: string) =>
  (await DiscoverPage.open(page, env, graphId, { panel: "ask" })).ask();

test("11 a browser without WebGPU fails the answer in Ask as ai/unavailable", async ({ page, env, corpusGraph }) => {
  await withoutWebGPU(page);
  await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
  // Said at once, by its code, rather than a load that never finishes.
  await expectProblem(page, "ai/unavailable", { within: 15_000 });
});

/* eslint-disable playwright/expect-expect -- a fixme says what it waits on, and asserts nothing yet */
test.fixme("12 the shards of the model cannot be downloaded", async () => {
  // waits on a runner with WebGPU: without one, the model refuses before it reads KEASY_MODEL_URL.
});

test.fixme("13 a model that stops writing mid-answer", async () => {
  // waits on a model double in the page: the model is no longer behind a route the suite can hold.
});

test.fixme("14 a model that fails mid-answer is a failure, not a short answer", async () => {
  // waits on a model double in the page: the model is no longer behind a route the suite can hold.
});

test.fixme("15 a structured answer that does not parse fails the step of the assistant, not as no suggestions", async () => {
  // waits on a model double in the page: the model is no longer behind a route the suite can hold.
});

test.fixme("16 an answer the spec does not admit fails in its card", async () => {
  // waits on a model double in the page: the model is no longer behind a route the suite can hold.
});

/* eslint-enable playwright/expect-expect */

test("the assistant on a browser without WebGPU fails its step as ai/unavailable, not as no suggestions", async ({ page }) => {
  await withoutWebGPU(page);
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
  await expectProblem(page, "ai/unavailable", { within: 20_000 });
});

// eslint-disable-next-line playwright/expect-expect -- a fixme says what it waits on, and asserts nothing yet
test.fixme("an answer added to the dashboard is saved as a tile of its relation", async () => {
  // waits on a model double in the page: the model is no longer behind a route the suite can hold.
});
