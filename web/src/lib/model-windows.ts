import "server-only";

import type { ModelWindows } from "./model-windows-context";

/** A window from the environment: a positive whole number of tokens, or none when unset or not one. */
function tokens(value: string | undefined): number | undefined {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Each alias's context window, as the platform declares it beside its model (`AI_CHAT_CONTEXT`,
 * `AI_COMPLETE_CONTEXT`, which compose hands the web as `KEASY_AI_*_CONTEXT`). Read at request time,
 * so one image serves any deployment. An alias with none is passed no budget, and nothing narrows.
 */
export function modelWindows(): ModelWindows {
  return {
    chat: tokens(process.env.KEASY_AI_CHAT_CONTEXT),
    complete: tokens(process.env.KEASY_AI_COMPLETE_CONTEXT),
  };
}
