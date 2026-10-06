import { expect, type Route } from "@playwright/test";

import { SOURCE } from "../support/api";
import { start, stop, up } from "../support/compose";
import { AI, ask, openPanel, sse, test, text } from "../support/fixtures";
import { expectProblem } from "../support/problem";

const stream = (route: Route, body: string) =>
  route.fulfill({ status: 200, contentType: "text/event-stream", body });

test("11 an AI gateway that is down fails the answer in Ask as llm/failed", async ({ page, corpusGraph }) => {
  test.setTimeout(180_000);
  stop("ai-gateway");
  try {
    await openPanel(page, corpusGraph, "Ask");
    await ask(page, "How many people are there?");
    // The BFF's forward cannot reach it and answers 500 with no code of its own: the failure is
    // the model call's, in keasy's words.
    await expectProblem(page, "llm/failed", { within: 20_000 });
  } finally {
    start("ai-gateway");
  }
});

test("12 a provider refusal the gateway relays is shown, not an empty answer", async ({ page, corpusGraph }) => {
  // The gateway passes a provider's refusal on in the protocol's error format, with its status;
  // the provider's words are the detail of the one view.
  await page.route(AI, (route) =>
    route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }),
    }),
  );
  await openPanel(page, corpusGraph, "Ask");
  await ask(page, "How many people are there?");
  await expectProblem(page, "llm/failed", { within: 15_000 });
});

test("13 an AI gateway that accepts and never answers is ai/silent", async ({ page, corpusGraph }) => {
  test.setTimeout(240_000);
  stop("ai-gateway");
  up("ai-gateway-silent");
  try {
    await openPanel(page, corpusGraph, "Ask");
    await ask(page, "How many people are there?");
    // The BFF forwards and waits; `@kanzo-tech/llm` gives the answer's headers 30 s.
    await expectProblem(page, "ai/silent", { within: 45_000 });
  } finally {
    stop("ai-gateway-silent");
    start("ai-gateway");
  }
});

test("14 an error event mid-stream is a failure, not a short answer", async ({ page, corpusGraph }) => {
  await page.route(AI, (route) =>
    stream(route, sse(text("There are"), { error: { message: "The server is overloaded", type: "server_error" } })),
  );
  await openPanel(page, corpusGraph, "Ask");
  await ask(page, "How many people are there?");
  await expectProblem(page, "llm/failed", { within: 15_000 });
});

test("15 a structured answer that does not parse fails the assistant's step, not as no suggestions", async ({ page }) => {
  // Suggesting requirements asks for JSON; prose instead fails the call, and says so.
  await page.route(AI, (route) => stream(route, sse(text("You should look at the people table."), text("", "stop"))));
  await page.goto("/graphs/new");
  await page.getByText("Assistant", { exact: true }).click();
  // Ark draws the checkbox's control over its input.
  await page.getByRole("checkbox", { name: `Select ${SOURCE}` }).check({ force: true });
  // In the dev stack TanStack's devtools button floats over the footer's corner.
  await page.addStyleTag({ content: ".tsqd-parent-container { display: none !important; }" });
  // Continue waits for the schemas, then asks for requirements on the Requirements screen.
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 60_000 });
  await expectProblem(page, "llm/failed", { within: 20_000 });
});

test("16 SQL the engine refuses reaches the answer card, and the model reads the engine's words", async ({ page, corpusGraph }) => {
  // What the model is handed back after the refusal: the engine's own words.
  let readBack = "";
  await page.route(AI, (route) => {
    const body = route.request().postData() ?? "";
    // The suggested questions are a call of their own, with no tools: the panel offers none here.
    if (!body.includes('"tools"')) return stream(route, sse(text("[]"), text("", "stop")));
    // The agent's second step carries the tool's result back.
    if (body.includes('"role":"tool"')) {
      readBack = body;
      return stream(route, sse(text("The query did not run."), text("", "stop")));
    }
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
  await openPanel(page, corpusGraph, "Ask");
  await ask(page, "How many people are there?");
  // The statement gate's refusal is the tool's answer, drawn in its card; the model reads DuckDB's words.
  await expect(page.locator('[data-slot="query-result"] [data-code="query/refused"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => readBack).toMatch(/syntax error/i);
});
