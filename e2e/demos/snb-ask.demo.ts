import type { Page } from "@playwright/test";

import { showPanel } from "./geo";
import { demo, demoGraph } from "./record";

/**
 * Load both model aliases before the camera rolls. The gateway ends a call that sends nothing for 20 s,
 * and a model's first call after loading can take longer than that; the load goes on in Model Runner
 * all the same, so a call that times out is tried again until one answers.
 */
async function warmUp(page: Page) {
  for (const model of ["chat", "complete"]) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const status = await page.evaluate(async (model) => {
        const response = await fetch("/api/ai/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 8, stream: false }),
        });
        return response.status;
      }, model);
      if (status === 200) break;
      await page.waitForTimeout(5000);
    }
  }
}

/**
 * Ask over LDBC SNB: a question in plain words, the answer as a query with its chart, and the answer
 * sent back to the page as a filter. The answer is the model's (`make demo` records with the larger
 * one in `models.yml`), so it differs between runs; record again if one reads badly.
 */
demo("snb-ask", "Ask over LDBC SNB: a plain question, its query and chart, and the answer as a filter", {
  async arrange(page) {
    const id = await demoGraph(page, "LDBC Social Network", "snb");
    await page.goto(`/graphs/${id}/discover`);
    // Dispatched rather than clicked, as in snb-explore: the Graph view of 327K nodes never settles
    // a frame on a machine without a GPU.
    await page.getByRole("radio", { name: "Dashboard" }).dispatchEvent("click", undefined, { timeout: 120_000 });
    await page.getByRole("heading", { name: /Count by / }).first().waitFor({ timeout: 60_000 });
    // People in view, so "what's in view" is what the question is about.
    await page.getByRole("combobox", { name: "Root type" }).click();
    await page.getByRole("option", { name: "Person" }).click();
    await page.getByRole("heading", { name: /Count by Person\.gender/ }).waitFor({ timeout: 60_000 });
    await warmUp(page);
    await showPanel(page, "Ask");
    await page.getByPlaceholder("Ask about your data…").waitFor({ timeout: 60_000 });
  },

  async act({ page, chapter, poster }) {
    // The same crossfilter as every chart: the question is asked over what the page has filtered.
    await chapter("Filter the page: women only");
    const gender = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: "Count by Person.gender" }) })
      .getByRole("img");
    const g = await gender.boundingBox();
    // The upper bar of two is `female`.
    await gender.click({ position: { x: g!.width * 0.45, y: g!.height * 0.3 } });
    await page.waitForTimeout(900);

    await chapter("Ask about what's in view, in plain words");
    const box = page.getByPlaceholder("Ask about your data…").describe("the question");
    await box.click();
    await box.pressSequentially("Which browsers do they use most?", { delay: 35 });
    await page.waitForTimeout(400);
    await box.press("Enter");

    // An answer with rows, which draws its toolbar; a refusal draws none. The model reads a refusal and
    // writes the query again, so the step waits for the one that ran — and a take with none fails
    // rather than recording "The query failed".
    const answer = page.locator('[data-slot="query-result"]').filter({ has: page.locator('[data-slot="query-result-toolbar"]') }).last();
    await answer.waitFor({ timeout: 180_000 });
    // The card appears with its query still running; the step is its result.
    await page
      .getByRole("complementary", { name: "Ask panel" })
      .getByText("Running", { exact: true })
      .waitFor({ state: "hidden", timeout: 120_000 });
    await chapter("Every answer is a query, with its chart");
    await page.waitForTimeout(900);
    await poster();

    // Not every answer can be a filter (an aggregate over no column the page has is not), so the
    // step is recorded only when the card offers it.
    const filter = answer.getByRole("button", { name: /^Filter to/ });
    if (await filter.isVisible()) {
      await chapter("Send the answer back to the page as a filter");
      await filter.describe("filter to it").click();
      await page.waitForTimeout(1400);
    }
  },
});
