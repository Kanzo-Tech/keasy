"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { LanguageModel } from "ai";
import type { ModelLoad } from "@kanzo-tech/llm";
import { loadLocalModel, localModel, localModelLoad, localProvider, setLocalProvider, watchLocalModel } from "@kanzo-tech/llm/local";

/**
 * The one model keasy asks: a WebLLM build that runs in the page, on WebGPU — Ask's Task, its offers
 * and the assistant all ask it. Nothing about a question leaves the browser, and no key or gateway
 * stands in front of it.
 *
 * Which model it is, and where its weights and library are, is not written here: the page serves
 * whatever `/models/app-config.json` lists — WebLLM's own `AppConfig`, which `make models`
 * (`infra/models.sh`) writes beside what it downloads — and asks the first model listed. A page whose
 * origin lists none has no model, never a third party's copy, and every call fails as
 * `llm/unavailable` with `reason: "unserved"` before anything is asked. An end-to-end test registers
 * its scripted model with `@kanzo-tech/testing`, which is asked first; nothing here knows.
 */

/** The models keasy's origin serves, from the engine's own worker, set once, before anything asks one. */
let provided = false;
function provide(): void {
  if (provided) return;
  provided = true;
  setLocalProvider(
    localProvider({ baseURL: "/models", worker: new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" }) }),
  );
}

/**
 * Starts the download and load, unless it is under way or done: a failed one is tried again. Its
 * failure is `localModelLoad`'s to say.
 */
function start() {
  provide();
  const { state } = localModelLoad();
  if (state === "loading" || state === "ready") return;
  // eslint-disable-next-line no-restricted-syntax -- not lost: localModelLoad says it failed, and why
  loadLocalModel().catch(() => {});
}

/** The model, for a screen that asks it. A call made while it loads waits for the load. */
export function useModel(): LanguageModel {
  if (typeof window !== "undefined") provide();
  return localModel();
}

/** Starts the download and load now — or again, after a failure: a retry's action. */
export function useLoadModel(): () => void {
  return useCallback(() => start(), []);
}

/**
 * Starts the download and load in the background when a person opens something they will ask the
 * model about — a graph, the assistant — so the first question does not wait on the weights; the page
 * works without it meanwhile. Loaded once per page, whichever screen asked first. Without WebGPU, or
 * with no model served, it fails at once, as `llm/unavailable`, before anything is downloaded.
 */
export function usePreloadModel(): void {
  const loadModel = useLoadModel();
  useEffect(loadModel, [loadModel]);
}

/** How the model's download and load stand in this page: what Ask and the assistant show until it is ready. */
export function useModelLoad(): ModelLoad {
  return useSyncExternalStore(
    useCallback((listener: () => void) => watchLocalModel(undefined, listener), []),
    () => localModelLoad(),
    () => localModelLoad(),
  );
}
