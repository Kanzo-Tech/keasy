import { type Route } from "@playwright/test";

import { start, stop, up } from "../support/compose";
import { AI, ask, openPanel, sse, test, text } from "../support/fixtures";
import { expectProblem } from "../support/problem";

const stream = (route: Route, body: string) =>
  route.fulfill({ status: 200, contentType: "text/event-stream", body });

test("11 an AI gateway that is down is gateway/unreachable in Ask", async ({ page, corpusJob }) => {
  test.setTimeout(180_000);
  stop("litellm");
  try {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    await expectProblem(page, "gateway/unreachable", { within: 20_000 });
  } finally {
    start("litellm");
  }
});

test("12 a provider refusal the gateway relays is shown, not an empty answer", async ({ page, corpusJob }) => {
  // The gateway answers a spent budget in the protocol's error format, with its status; the
  // provider's words are the detail of the one view.
  await page.route(AI, (route) =>
    route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }),
    }),
  );
  await openPanel(page, corpusJob, "Ask");
  await ask(page, "How many people are there?");
  await expectProblem(page, "llm/failed", { within: 15_000 });
});

test("13 an AI gateway that accepts and never answers is gateway/silent", async ({ page, corpusJob }) => {
  test.setTimeout(240_000);
  stop("litellm");
  up("litellm-silent");
  try {
    await openPanel(page, corpusJob, "Ask");
    await ask(page, "How many people are there?");
    // The relay gives the gateway 25 s, under the browser's 30 s.
    await expectProblem(page, "gateway/silent", { within: 45_000 });
  } finally {
    stop("litellm-silent");
    start("litellm");
  }
});

test("14 an error event mid-stream is a failure, not a short answer", async ({ page, corpusJob }) => {
  await page.route(AI, (route) =>
    stream(route, sse(text("There are"), { error: { message: "The server is overloaded", type: "server_error" } })),
  );
  await openPanel(page, corpusJob, "Ask");
  await ask(page, "How many people are there?");
  await expectProblem(page, "llm/failed", { within: 15_000 });
});

test("15 a structured answer that does not parse fails the assistant's step, not as no suggestions", async ({ page }) => {
  // Suggesting requirements asks for JSON; prose instead fails the call, and says so.
  await page.route(AI, (route) => stream(route, sse(text("You should look at the people table."), text("", "stop"))));
  await page.goto("/jobs/new");
  await page.getByText("Assistant", { exact: true }).click();
  // Ark draws the checkbox's control over its input.
  await page.getByRole("checkbox", { name: "Select MinIO dev bucket" }).check({ force: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.click();
  await next.click({ timeout: 60_000 });
  await expectProblem(page, "llm/failed", { within: 20_000 });
});

test("16 SQL the engine refuses is engine/failed in the tool's frame", async ({ page, corpusJob }) => {
  let calls = 0;
  await page.route(AI, (route) => {
    calls++;
    if (calls > 1) return stream(route, sse(text("The query did not run."), text("", "stop")));
    const call = {
      id: "e2e",
      object: "chat.completion.chunk",
      created: 0,
      model: "chat",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              { index: 0, id: "call_1", type: "function", function: { name: "query", arguments: '{"sql":"SELEC 1"}' } },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const done = { ...call, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
    return stream(route, sse(call, done));
  });
  await openPanel(page, corpusJob, "Ask");
  await ask(page, "How many people are there?");
  // fossil's own code for a statement its engine refused: the corpus raised it.
  await expectProblem(page, "engine/failed", { within: 20_000 });
});
