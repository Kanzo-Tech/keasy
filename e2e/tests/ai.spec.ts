import { expect, type Page, type Route } from "@playwright/test";
import type { HarnessEnvironment } from "@kanzo-tech/testing";

import { api, SOURCE } from "../support/stack/api";
import { start, stop, up } from "../support/stack/compose";
import { DiscoverPage } from "../support/app";
import { AI, sse, test, text } from "../support/fixtures";
import { expectProblem } from "../support/stack/problem";

const stream = (route: Route, body: string) =>
  route.fulfill({ status: 200, contentType: "text/event-stream", body });

/** The graph's Ask panel, docked from the URL. */
const askPanel = async (page: Page, env: HarnessEnvironment, graphId: string) =>
  (await DiscoverPage.open(page, env, graphId, { panel: "ask" })).ask();

test("11 an AI gateway that is down fails the answer in Ask as ai/unavailable", async ({ page, env, corpusGraph }) => {
  test.setTimeout(180_000);
  stop("ai-gateway");
  try {
    await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
    // The BFF's forward cannot reach it and answers 500 with no code of its own: `@kanzo-tech/llm`
    // names an error answer from the gateway's side `ai/unavailable`.
    await expectProblem(page, "ai/unavailable", { within: 20_000 });
  } finally {
    start("ai-gateway");
  }
});

test("12 a provider refusal the gateway relays is shown, not an empty answer", async ({ page, env, corpusGraph }) => {
  // The gateway passes a provider's refusal on in the protocol's error format, with its status;
  // the provider's words are the detail of the one view.
  await page.route(AI, (route) =>
    route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }),
    }),
  );
  await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
  await expectProblem(page, "ai/unavailable", { within: 15_000 });
});

test("13 an AI gateway that accepts and never answers is ai/silent", async ({ page, env, corpusGraph }) => {
  test.setTimeout(240_000);
  stop("ai-gateway");
  up("ai-gateway-silent");
  try {
    await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
    // The BFF forwards and waits; `@kanzo-tech/llm` gives the answer's headers 30 s.
    await expectProblem(page, "ai/silent", { within: 45_000 });
  } finally {
    stop("ai-gateway-silent");
    start("ai-gateway");
  }
});

test("14 an error event mid-stream is a failure, not a short answer", async ({ page, env, corpusGraph }) => {
  await page.route(AI, (route) =>
    stream(route, sse(text("There are"), { error: { message: "The server is overloaded", type: "server_error" } })),
  );
  await (await askPanel(page, env, corpusGraph)).send("How many people are there?");
  await expectProblem(page, "llm/failed", { within: 15_000 });
});

test("15 a structured answer that does not parse fails the assistant's step, not as no suggestions", async ({ page }) => {
  // Suggesting requirements asks for JSON; prose instead fails the call, and says so.
  await page.route(AI, (route) => stream(route, sse(text("You should look at the people table."), text("", "stop"))));
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
  await expectProblem(page, "llm/failed", { within: 20_000 });
});

/**
 * The Ask agent as a mocked model: the suggested questions are a call of their own, with no tools,
 * and get none; the agent's first step calls `answer` with `input`; its second, which carries the
 * tool's result back, says `then` and stops. `onReadBack` hears what the model was handed.
 */
function answering(input: unknown, then: string, onReadBack: (body: string) => void = () => {}) {
  return (route: Route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"tools"')) return stream(route, sse(text("[]"), text("", "stop")));
    if (body.includes('"role":"tool"')) {
      onReadBack(body);
      return stream(route, sse(text(then), text("", "stop")));
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
            tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "answer", arguments: JSON.stringify(input) } }],
          },
          finish_reason: null,
        },
      ],
    };
    const done = { ...call, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
    return stream(route, sse(call, done));
  };
}

test("16 an answer the spec does not admit fails in its card, and the model reads why", async ({ page, env, corpusGraph }) => {
  // The model names a field Person does not have; the tool's input is checked before anything runs,
  // and what the model is handed back is the check's own words.
  let readBack = "";
  await page.route(
    AI,
    answering(
      {
        relation: { root: "Person", path: [] },
        where: [{ field: "Person.shoeSize", in: ["42"] }],
        show: { kind: "stat", measure: { op: "count" } },
      },
      "That field is not in the graph.",
      (body) => (readBack = body),
    ),
  );
  const answers = await (await askPanel(page, env, corpusGraph)).composer();
  await answers.ask("How many people wear a 42?");
  // The refusal is the tool's answer, drawn in its card, and it names the field that is not there.
  await expect(answers.answer()).rejects.toThrow(/Person\.shoeSize is not a field of Person/);
  await expect.poll(() => readBack).toMatch(/Person\.shoeSize is not a field of Person/);
});

test("an answer added to the dashboard is saved as a tile of its relation", async ({ page, env, corpusGraph }) => {
  const title = `Asked ${Date.now()}`;
  await page.route(
    AI,
    answering({ relation: { root: "Person", path: [] }, show: { kind: "stat", measure: { op: "count" }, title } }, "That is everyone."),
  );
  const answers = await (await askPanel(page, env, corpusGraph)).composer();
  await answers.ask("How many people are there?");
  // Resolves on the card's own *✓ On the dashboard*, read from the dashboards the page handed back.
  await answers.addToDashboard();
  // Written at once, not after the editor's pause: an addition is a decision, not typing.
  await expect
    .poll(async () => JSON.stringify((await api(page, "GET", `/v1/graphs/${corpusGraph}/dashboard`)).body), { timeout: 10_000 })
    .toContain(title);
});
