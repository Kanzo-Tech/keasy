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
   * drawn (a gateway that is down or silent), whose failure is the panel's `Problem`, not a card's.
   */
  async send(question: string): Promise<void> {
    const box = await this.one({ role: "textbox", name: COMPOSER }, "the panel has no composer");
    await box.fill(question);
    await box.press("Enter");
  }

  /**
   * Loads both model aliases before a take that asks them. The gateway ends a call that sends nothing
   * for 20 s, and a model's first call after loading can take longer; the load goes on in Model Runner
   * all the same, so a call that fails is made again until one answers.
   */
  async warmUp(): Promise<void> {
    for (const model of ["chat", "complete"]) {
      await this.env.until(
        () =>
          this.host.evaluate(async (_, alias) => {
            const response = await fetch("/api/ai/chat/completions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ model: alias, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 8, stream: false }),
            });
            return response.status === 200;
          }, model),
        `the model ${model} never answered`,
      );
    }
  }
}
