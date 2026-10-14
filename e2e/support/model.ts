import type { Page } from "@playwright/test";
import { type KanzoTestingHook, type ModelScript, type ModelTurn, playwright } from "@kanzo-tech/testing";

/**
 * **The page's model, scripted.** The model runs in the browser, on WebGPU (`web/src/lib/ai.ts`), and
 * CI's Chromium has none, so a scenario that needs an answer registers a script for keasy's model with
 * `@kanzo-tech/testing` before the page loads: `@kanzo-tech/llm/local`'s `localModel` then answers
 * from it, its load included, and records every prompt. keasy's own code never knows.
 */

/** keasy's model, as `web/src/lib/ai.ts` names it: the id the script is registered under. */
const MODEL = "Qwen3-4B-q4f16_1-MLC";

/**
 * Ask's offers, which its panel asks for as soon as the model is ready: none, so no pill and no
 * failure stand beside what a scenario asserts. A scenario's own turn for them comes first.
 */
const NO_OFFERS: ModelTurn = { when: "different from one another", reply: { text: JSON.stringify({ elements: [] }) } };

/** Answers keasy's model from `script` on every page this one loads from now on. */
export async function scriptModel(page: Page, script: ModelScript): Promise<void> {
  await playwright(page, { models: { [MODEL]: { ...script, turns: [...script.turns, NO_OFFERS] } } });
}

/** Every prompt keasy's model was asked, in order. */
export function promptsOf(page: Page): Promise<string[]> {
  return page.evaluate(
    (id) => (globalThis as { __KANZO_TESTING__?: KanzoTestingHook }).__KANZO_TESTING__?.models.get(id)?.prompts ?? [],
    MODEL,
  );
}
