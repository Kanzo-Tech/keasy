import { expect, test as base, type Page } from "@playwright/test";

import { createJob } from "./api";

/** A job the browser has run to completion, so its corpus opens in Discovery. */
async function runToCompletion(page: Page): Promise<string> {
  const id = await createJob(page, { name: "e2e corpus" });
  await page.goto(`/jobs/${id}`);
  await expect(page.getByRole("link", { name: "Open Discovery" })).toBeVisible({ timeout: 180_000 });
  return id;
}

/** The model calls the page makes, through the BFF to the server's relay to the AI gateway. */
export const AI = "**/api/v1/ai/chat/completions";

/** OpenAI chat completion chunks as the gateway streams them, ending the stream. */
export function sse(...chunks: unknown[]): string {
  return [...chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
}

/** One chunk of an answer's text. */
export function text(content: string, finish: string | null = null) {
  return { id: "e2e", object: "chat.completion.chunk", created: 0, model: "chat", choices: [{ index: 0, delta: { content }, finish_reason: finish }] };
}

/** Open a job's Discovery on the dock panel `panel` (Info · Ask · Rules · Settings). */
export async function openPanel(page: Page, jobId: string, panel: "Ask" | "Rules") {
  await page.goto(`/jobs/${jobId}/discover`);
  await page.getByRole("button", { name: panel, exact: true }).or(page.getByRole("radio", { name: panel })).first().click();
}

/** Ask the Ask panel `question`. */
export async function ask(page: Page, question: string) {
  const box = page.getByPlaceholder("Ask about your data…");
  await box.fill(question);
  await box.press("Enter");
}

export const test = base.extend<object, { corpusJob: string }>({
  corpusJob: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: ".auth/member.json", baseURL: process.env.KEASY_URL ?? "http://localhost:3000" });
      const page = await context.newPage();
      const id = await runToCompletion(page);
      await context.close();
      await use(id);
    },
    { scope: "worker" },
  ],
});

export { expect };
