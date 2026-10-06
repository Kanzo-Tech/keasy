import { expect, test as base, type Page } from "@playwright/test";

import { createGraph } from "./api";
import { signIn } from "./sign-in";

/** A graph the browser has run to completion, so its corpus opens in Discovery. */
async function runToCompletion(page: Page): Promise<string> {
  const id = await createGraph(page, { name: "e2e corpus" });
  await page.goto(`/graphs/${id}`);
  // Opening the page runs nothing: the run is asked for.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore" })).toBeEnabled({ timeout: 180_000 });
  return id;
}

/** The model calls the page makes, through the BFF's forward to the AI gateway. */
export const AI = "**/api/ai/chat/completions";

/** OpenAI chat completion chunks as the gateway streams them, ending the stream. */
export function sse(...chunks: unknown[]): string {
  return [...chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
}

/** One chunk of an answer's text. */
export function text(content: string, finish: string | null = null) {
  return { id: "e2e", object: "chat.completion.chunk", created: 0, model: "chat", choices: [{ index: 0, delta: { content }, finish_reason: finish }] };
}

/** Open a graph's Discovery on the dock panel `panel` (Info · Ask · Rules · Settings). */
export async function openPanel(page: Page, graphId: string, panel: "Ask" | "Rules") {
  await page.goto(`/graphs/${graphId}/discover`);
  await page.getByRole("button", { name: panel, exact: true }).or(page.getByRole("radio", { name: panel })).first().click();
}

/** Ask the Ask panel `question`. */
export async function ask(page: Page, question: string) {
  const box = page.getByPlaceholder("Ask about your data…");
  await box.fill(question);
  await box.press("Enter");
}

export const test = base.extend<object, { corpusGraph: string }>({
  corpusGraph: [
    async ({ browser }, use) => {
      // Worker-scoped, so it signs in on a context of its own rather than a test's.
      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        baseURL: process.env.KEASY_URL ?? "http://acme.localhost:3000",
      });
      const page = await context.newPage();
      await signIn(page, "bruno");
      const id = await runToCompletion(page);
      await context.close();
      await use(id);
    },
    { scope: "worker" },
  ],
});

export { expect };
