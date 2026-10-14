import { AnswerHarness, ComponentHarness, type By } from "@kanzo-tech/testing";

/** The composer's placeholder, which is its accessible name. */
const COMPOSER = "Ask about your data…";

/**
 * **The Ask panel** — keasy's dock panel round `@kanzo-tech/ai`'s data agent. Its answers are the
 * library's `AnswerCard`s, which `AnswerHarness` drives: `composer()` hands it over, narrowed to this
 * panel's composer.
 */
export class AskPanel extends ComponentHarness {
  static readonly by: By = { role: "complementary", name: "Ask panel" };

  /** The library's harness over the panel's composer and its answer cards. */
  composer(): Promise<AnswerHarness> {
    return this.locatorFor(AnswerHarness.with({ name: COMPOSER }))();
  }

  /**
   * Sends `question` without waiting for an answer card: for a model call that fails before one is
   * drawn (a browser that cannot run the model), whose failure is the panel's `Problem`, not a card's.
   */
  async send(question: string): Promise<void> {
    const box = await this.locatorFor({ role: "textbox", name: COMPOSER }, "the panel has no composer")();
    await box.fill(question);
    await box.sendKeys("Enter");
  }

  /**
   * Waits for the model to load in the page — the graph starts it as it opens, and the first time on a
   * machine that is the download — before a take or a case that asks it, so the clock measures the
   * model and not the load. A browser that cannot run it fails at once, with the code behind the badge.
   */
  async warmUp(): Promise<void> {
    const panel = await this.locatorFor({ css: "[data-model]" }, "the panel says nothing of the model")();
    const state = await this.env.until(async () => {
      const now = await panel.getAttribute("data-model");
      return now === "ready" || now === "failed" ? now : undefined;
    }, "the model never loaded");
    if (state === "ready") return;
    // Why is behind the model's badge, in a popover outside the panel.
    await (await this.locatorFor({ css: '[data-slot="model-badge"]' }, "the panel has no model badge")()).click();
    const problem = await this.env.until(
      async () => (await this.env.rootElement.find({ css: '[data-slot="model-badge-content"] [data-code]' }))[0],
      "the model's badge opened no problem",
    );
    throw new Error(`the model cannot run in this browser: ${(await problem?.getAttribute("data-code")) ?? "no code"}`);
  }
}
