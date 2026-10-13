"use client";

import { createContext, createElement, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";
import type { LanguageModel } from "@kanzo-tech/llm";
import { loadLocalModel, localModel, type LocalModelSettings } from "@kanzo-tech/llm/local";

/**
 * The one model keasy asks, and the only place it is named: a WebLLM build that runs in the page, on
 * WebGPU — Ask's Task, its offers and the wizard all ask it. Nothing about a question leaves the
 * browser, and no key or gateway stands in front of it. Its window travels with it.
 */
export const MODEL = "Qwen3-4B-q4f16_1-MLC";

/**
 * Where the model's shards are served (`KEASY_MODEL_URL`), read by the server at request time so one
 * image serves any deployment, and handed down from the layout. Under it, as `@kanzo-tech/llm/local`
 * lays them out: `<url>/<MODEL>/`, the MLC weights directory, and `<url>/<MODEL>.wasm`, the compiled
 * library. A path is this origin's. Unset, WebLLM's own prebuilt list is read: the weights from
 * Hugging Face, the library from GitHub.
 */
const ModelUrl = createContext<string | undefined>(undefined);

export function ModelProvider({ url, children }: { url: string | undefined; children: ReactNode }) {
  return createElement(ModelUrl.Provider, { value: url }, children);
}

/** How the model's download and load stand in this page: once loaded, every call starts at once. */
export type ModelLoad =
  | { state: "idle" }
  | { state: "loading"; progress: number; text: string }
  | { state: "ready" }
  | { state: "failed"; error: unknown };

const IDLE: ModelLoad = { state: "idle" };
let load: ModelLoad = IDLE;
const listeners = new Set<() => void>();
function publish(next: ModelLoad) {
  load = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// One engine per page, in a worker of its own: the first caller's settings are the engine's for good.
let settings: LocalModelSettings | undefined;
function settingsFor(url: string | undefined): LocalModelSettings {
  if (settings) return settings;
  // WebLLM reads the weights' directory as an absolute URL, and from its worker: a path is resolved here.
  const base = url ? new URL(url.endsWith("/") ? url : `${url}/`, window.location.href) : undefined;
  settings = {
    worker: new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" }),
    onProgress: ({ progress, text }) => publish({ state: "loading", progress, text }),
    from: base && { weights: new URL(`${MODEL}/`, base).href, library: new URL(`${MODEL}.wasm`, base).href },
  };
  return settings;
}

/**
 * The model, for a screen that asks it. On the server — a client component's first render — it is the
 * bare model, which nothing calls there: the worker exists only in a browser.
 */
export function useModel(): LanguageModel {
  const url = useContext(ModelUrl);
  return typeof window === "undefined" ? localModel(MODEL) : localModel(MODEL, settingsFor(url));
}

/**
 * Starts the download and load when the screen that will ask opens — not on its first question — and
 * reads how it stands. Loaded once per page; a load that failed is tried again by the next screen,
 * not remembered. Without WebGPU it fails at once, as `ai/unavailable`, before anything is downloaded.
 */
export function useModelLoad(): ModelLoad {
  const url = useContext(ModelUrl);
  useEffect(() => {
    if (load.state !== "idle" && load.state !== "failed") return;
    publish({ state: "loading", progress: 0, text: "" });
    loadLocalModel(MODEL, settingsFor(url)).then(
      () => publish({ state: "ready" }),
      (error: unknown) => publish({ state: "failed", error }),
    );
  }, [url]);
  return useSyncExternalStore(subscribe, () => load, () => IDLE);
}
