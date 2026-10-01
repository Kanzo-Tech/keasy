import { api } from "../support/api";
import { ask, MODEL_CONNECTION, openPanel, test, withModel } from "../support/fixtures";
import { expectProblem } from "../support/problem";

test("11 no model connection is llm/not-configured in Ask", async ({ page, corpusJob }) => {
  // The assistant's half of this scenario shows `useAi`'s error as text until kanzo-ui 0.17.
  await api(page, "DELETE", `/v1/connections/${encodeURIComponent(MODEL_CONNECTION)}`);
  await openPanel(page, corpusJob, "Ask");
  await expectProblem(page, "llm/not-configured", { within: 15_000 });
});

test("12 a provider without credit is llm/insufficient-credits", async ({ page, corpusJob }) => {
  await withModel(page, "no-credit", async () => {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    await expectProblem(page, "llm/insufficient-credits", { within: 15_000 });
  });
});

test("13 a provider that goes quiet mid-stream is llm/silent within the idle deadline", async ({ page, corpusJob }) => {
  await withModel(page, "silent", async () => {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    // The server cuts the provider after 30 s idle.
    await expectProblem(page, "llm/silent", { within: 45_000 });
  });
});

test("14 an error event mid-stream is llm/failed, not a short answer", async ({ page, corpusJob }) => {
  await withModel(page, "error-mid", async () => {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    await expectProblem(page, "llm/failed", { within: 15_000 });
  });
});

test("15 an answer that is not JSON is llm/unparseable", async ({ page, corpusJob }) => {
  await withModel(page, "prose", async () => {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    await expectProblem(page, "llm/unparseable", { within: 15_000 });
  });
});
