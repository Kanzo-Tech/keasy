"use client";

import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { AiError, type LanguageModel, type ModelLoad } from "@kanzo-tech/llm";
import { type LocalModelSettings, loadLocalModel, localModel, localModelLoad, watchLocalModel } from "@kanzo-tech/llm/local";

/**
 * The one model keasy asks, and the only place it is named: a WebLLM build that runs in the page, on
 * WebGPU — Ask's Task, its offers and the wizard all ask it. Nothing about a question leaves the
 * browser, and no key or gateway stands in front of it. Its window travels with it.
 */
export const MODEL = "Qwen3-4B-q4f16_1-MLC";

/**
 * Where its two halves are under `KEASY_MODEL_URL`, each path naming one content for good: the weights
 * by their revision of `mlc-ai/<MODEL>` on Hugging Face, the compiled library by the WebLLM release it
 * was built for, which must be the one installed. A shard is therefore served as immutable, and a new
 * pin is a new URL rather than a stale cache. `resolve/<revision>/` is Hugging Face's layout and
 * WebLLM's: it appends `resolve/main/` to a weights URL that names no revision. `make models`
 * (`infra/models.sh`) downloads exactly these, and `ai.test.ts` holds the three to each other.
 */
export const WEIGHTS = `${MODEL}/resolve/a5c9fab855e3ccbdfed2e7e69683d75f30332161/`;
export const LIBRARY = "lib/v0_2_86/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm";

/**
 * Where the model's shards are served (`KEASY_MODEL_URL`), read by the server at request time so one
 * image serves any deployment, and handed down from the layout: a path on keasy's own origin, `/models`
 * in development and behind a deployment's edge alike. Unset, or on another origin, there is no model
 * — never a third party's copy — and Ask and the assistant say so (`ai/unavailable`, `reason:
 * "unserved"`).
 */
const ModelUrl = createContext<string | undefined>(undefined);

export function ModelProvider({ url, children }: { url: string | undefined; children: ReactNode }) {
  return createElement(ModelUrl.Provider, { value: url }, children);
}

const unserved = () =>
  new AiError("ai/unavailable", "This deployment serves no model on its origin (KEASY_MODEL_URL)", { reason: "unserved" });

/** The load of a deployment that serves no model: failed before anything is asked, and for good. */
const UNSERVED_LOAD: ModelLoad = { state: "failed", error: unserved() };

/** `KEASY_MODEL_URL` as a URL on this origin, or nothing when it names none or another origin. */
function servedFrom(url: string | undefined): URL | undefined {
  if (!url) return undefined;
  const base = new URL(url.endsWith("/") ? url : `${url}/`, window.location.href);
  return base.origin === window.location.origin ? base : undefined;
}

/**
 * The model of a page with none to ask: on the server, where nothing calls it, and in a deployment that
 * serves none, where every call fails as `ai/unavailable` before anything is asked.
 */
const UNSERVED: LanguageModel = {
  specificationVersion: "v4",
  provider: "keasy",
  modelId: MODEL,
  supportedUrls: {},
  doGenerate: () => Promise.reject(unserved()),
  doStream: () => Promise.reject(unserved()),
};

/**
 * The end-to-end suite's model double (`e2e/support/model.ts`): a model, and where its load stands, put
 * on the page before it loads, which every screen then asks in place of WebLLM — CI's browsers have no
 * WebGPU. Development builds only: `process.env.NODE_ENV` is inlined when the bundle is built, so a
 * production bundle keeps neither this branch nor the name it reads (`model-double.test.ts`).
 */
interface ModelDouble {
  model: LanguageModel;
  load: ModelLoad;
}
function modelDouble(): ModelDouble | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  return (window as { __keasyModelDouble?: ModelDouble }).__keasyModelDouble;
}

// One engine per page, in a worker of its own: the first caller's settings are the engine's for good.
let settings: LocalModelSettings | undefined;
function settingsFor(base: URL): LocalModelSettings {
  if (settings) return settings;
  // WebLLM reads both as absolute URLs, and from its worker: the path is resolved here, on this origin.
  settings = {
    worker: new Worker(new URL("./model.worker.ts", import.meta.url), { type: "module" }),
    from: { weights: new URL(WEIGHTS, base).href, library: new URL(LIBRARY, base).href },
  };
  return settings;
}

/**
 * Starts the download and load, unless it is under way or done: a failed one is tried again. Its
 * failure is `localModelLoad`'s to say. A double's load and a deployment with no model have nothing
 * to start.
 */
function start(url: string | undefined) {
  const base = servedFrom(url);
  if (modelDouble() || !base) return;
  const { state } = localModelLoad(MODEL);
  if (state === "loading" || state === "ready") return;
  loadLocalModel(MODEL, settingsFor(base)).catch(() => {}); // Not lost: localModelLoad says it failed, and why.
}

/** The model, for a screen that asks it. A call made while it loads waits for the load. */
export function useModel(): LanguageModel {
  const url = useContext(ModelUrl);
  if (typeof window === "undefined") return UNSERVED;
  const base = servedFrom(url);
  return modelDouble()?.model ?? (base ? localModel(MODEL, settingsFor(base)) : UNSERVED);
}

/** Starts the download and load now — or again, after a failure: a retry's action. */
export function useLoadModel(): () => void {
  const url = useContext(ModelUrl);
  return useCallback(() => start(url), [url]);
}

/**
 * Starts the download and load in the background when a person opens something they will ask the
 * model about — a graph, the wizard, the assistant — so the first question does not wait on the
 * weights; the page works without it meanwhile. Loaded once per page, whichever screen asked first.
 * Without WebGPU it fails at once, as `ai/unavailable`, before anything is downloaded.
 */
export function usePreloadModel(): void {
  const loadModel = useLoadModel();
  useEffect(loadModel, [loadModel]);
}

/**
 * How the model's download and load stand in this page — `@kanzo-tech/llm/local`'s, the double's, or
 * failed for good where no model is served: what Ask and the assistant show until it is ready.
 */
export function useModelLoad(): ModelLoad {
  const url = useContext(ModelUrl);
  const current = () => modelDouble()?.load ?? (servedFrom(url) ? localModelLoad(MODEL) : UNSERVED_LOAD);
  return useSyncExternalStore(
    useCallback((listener: () => void) => watchLocalModel(MODEL, listener), []),
    current,
    () => localModelLoad(MODEL),
  );
}
