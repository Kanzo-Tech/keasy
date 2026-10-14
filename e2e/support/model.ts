import type { Page } from "@playwright/test";
import { type KanzoTestingHook, type ModelScript, type ModelTurn, playwright } from "@kanzo-tech/testing";

/**
 * **The page's model, scripted.** The model runs in the browser, on WebGPU (`web/src/lib/ai.ts`), and
 * CI's Chromium has none, so a scenario that needs an answer registers a script for keasy's model with
 * `@kanzo-tech/testing` before the page loads: it is registered in `@kanzo-tech/llm/local`'s provider
 * registry, which the page's `localModel()` asks before the models its origin serves, so it answers in
 * their place, its load included, and every prompt is recorded. keasy's own code never knows.
 */

/** The id the script is registered under, the model `infra/models.sh` lists: the page asks the first registered. */
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
