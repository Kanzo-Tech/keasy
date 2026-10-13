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
    return this.locate(AnswerHarness.with({ name: COMPOSER }));
  }

  /**
   * Sends `question` without waiting for an answer card: for a model call that fails before one is
   * drawn (a browser that cannot run the model), whose failure is the panel's `Problem`, not a card's.
   */
  async send(question: string): Promise<void> {
    const box = await this.one({ role: "textbox", name: COMPOSER }, "the panel has no composer");
    await box.fill(question);
    await box.press("Enter");
  }

  /**
   * Waits for the model to load in the page — the panel starts it as it opens, and the first time on a
   * machine that is the download — before a take or a case that asks it, so the clock measures the
   * model and not the load. A browser that cannot run it fails at once, with the panel's code.
   */
  async warmUp(): Promise<void> {
    const panel = await this.one({ css: "[data-model]" }, "the panel says nothing of the model");
    const state = await this.env.until(async () => {
      const now = await panel.attribute("data-model");
      return now === "ready" || now === "failed" ? now : undefined;
    }, "the model never loaded");
    if (state === "ready") return;
    const problem = (await this.host.find({ css: "[data-problem][data-code]" }))[0];
    throw new Error(`the model cannot run in this browser: ${(await problem?.attribute("data-code")) ?? "no code"}`);
  }
}
