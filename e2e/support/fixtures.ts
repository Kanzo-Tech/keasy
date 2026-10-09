import type { Page } from "@playwright/test";

import { signIn } from "./auth/sign-in";
import { expect, test as base } from "./env";
import { createGraph } from "./stack/api";

/**
 * A graph the browser has run to completion, so its corpus opens in Discovery: the suite's shop, or
 * `script`, given `within` ms to run.
 */
export async function runToCompletion(
  page: Page,
  { name = "e2e corpus", script, within = 180_000 }: { name?: string; script?: string; within?: number } = {},
): Promise<string> {
  const id = await createGraph(page, { name, script });
  await page.goto(`/graphs/${id}`);
  // Opening the page runs nothing: the run is asked for.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore" })).toBeEnabled({ timeout: within });
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

/**
 * A graph's Discovery as its URL names it: the `view` in the main region and the dock's `panel`, or
 * `none` for the dock collapsed. Left out, each is the page's default: Graph, and Info beside it —
 * nothing beside a dashboard.
 */
export function discoverUrl(
  graphId: string,
  { view, panel }: { view?: "graph" | "dashboard"; panel?: "info" | "ask" | "rules" | "settings" | "none" } = {},
): string {
  const query = new URLSearchParams();
  if (view) query.set("view", view);
  if (panel) query.set("panel", panel);
  return `/graphs/${graphId}/discover${query.size ? `?${query}` : ""}`;
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
