import type { Page } from "@playwright/test";

/**
 * Both aliases loaded and answering before a case is timed: a first call after a load can outlast the
 * gateway's 20 s to a first token, which would score the load and not the model.
 *
 * Only a call that may yet succeed is asked again — no answer at all, a 5xx, a 429. A 4xx other than
 * that is the gateway saying the alias has no model behind it (Model Runner answers 404 for a model it
 * was never given), and that fails at once, with what it said, rather than after `within` ms.
 */
export async function warmUp(page: Page, within: number): Promise<void> {
  for (const alias of ["chat", "complete"]) {
    const until = Date.now() + within;
    for (;;) {
      const { status, body } = await page.evaluate(async (model) => {
        try {
          const response = await fetch("/api/ai/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 8, stream: false }),
          });
          return { status: response.status, body: (await response.text()).slice(0, 300) };
        } catch (error) {
          return { status: 0, body: String(error) };
        }
      }, alias);
      if (status === 200) break;
      const retry = status === 0 || status === 429 || status >= 500;
      if (!retry || Date.now() > until) throw new Error(`the model behind "${alias}" does not answer: ${status} ${body}`);
      await page.waitForTimeout(5_000);
    }
  }
}
