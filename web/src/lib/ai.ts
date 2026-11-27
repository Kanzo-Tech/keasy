"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { apiError } from "@keasy/api";
import { Problem } from "@kanzo-tech/kernel";
import type { ModelLoad } from "@kanzo-tech/llm";
import { loadLocalModel, localModel, localModelLoad, localProvider, setLocalProvider, watchLocalModel } from "@kanzo-tech/llm/local";
import { useQueryClient } from "@tanstack/react-query";
import { $api, type Schemas } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { deadlineFetch } from "@/lib/deadline";
import { API } from "@/lib/routes";
import { type Json, type JsonObject, mendedCompletion, refusesSchema, schemaRequests } from "@/lib/strict-schema";

/**
 * The model keasy asks, one of two. When an admin set an external model (`/v1/ai/model`), every call
 * goes to it through the server's relay (`/v1/ai/chat/completions`): the server holds the key and
 * names the model, and nothing is downloaded here. Otherwise it is the one below.
 *
 * The page's own model: a WebLLM build that runs in the page, on WebGPU — Ask's Task, its offers
 * and the assistant all ask it. Nothing about a question leaves the browser, and no key or gateway
 * stands in front of it.
 *
 * Which model it is, and where its weights and library are, is not written here: the page serves
 * whatever `/models/app-config.json` lists — WebLLM's own `AppConfig`, `public/models/app-config.json`,
 * whose URLs are Hugging Face's and GitHub's at pinned revisions — and asks the first model listed. A
 * page whose origin lists none has no model, and every call fails as
 * `llm/unavailable` with `reason: "unserved"` before anything is asked. An end-to-end test registers
 * its scripted model with `@kanzo-tech/testing`, which is asked first; nothing here knows.
 */

/** The models keasy's origin lists, from the engine's own worker, set once, before anything asks one. */
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

/** The workspace's external model, as every member reads it. */
export type ExternalModel = Schemas["AiModelView"];

/** Which model the workspace runs on, read once a minute at most: an admin changes it rarely. */
const STALE_MS = 60_000;
const modelQuery = $api.queryOptions("get", "/v1/ai/model", undefined, { staleTime: STALE_MS });

/**
 * The workspace's external model, or `null` when it has none and the page's model is asked.
 * Suspends while it is read; a failure throws to the screen's boundary.
 */
export function useExternalModel(): ExternalModel | null {
  const { external } = settled($api.useSuspenseQuery("get", "/v1/ai/model", undefined, { staleTime: STALE_MS }));
  return external ?? null;
}

/** Nothing came back from the relay within `ms`: before the answer began, or between two chunks of it. */
function relaySilent(ms: number): Problem {
  return new Problem("server/silent", `Nothing came back for ${ms / 1000} s.`, { after: ms }, { title: "The server did not answer in time" });
}

/** What a mended answer cannot carry over: its length and encoding are the original's. */
const STALE_HEADERS = ["content-length", "content-encoding"];

/**
 * The relay's `fetch`: bounded like every API call, and a refusal thrown as the server's own
 * `Problem` (`ai/refused`, `ai/silent`…) rather than read as the provider's error format, which it is
 * not. An answer with a JSON schema is asked for loose, the schema a guide Ask checks the answer
 * against; a provider that refuses that (Claude takes only strict) is asked once more in strict mode,
 * its optional fields nullable, and the answer comes back with those `null`s dropped
 * (`strict-schema.ts`).
 */
const relayFetch: typeof fetch = async (input, init) => {
  const call = (body: JsonObject | undefined) =>
    deadlineFetch(relaySilent)(input, body === undefined ? init : { ...init, body: JSON.stringify(body) });
  const requests = typeof init?.body === "string" ? schemaRequests(JSON.parse(init.body) as JsonObject) : undefined;
  let strict = false;
  let response = await call(requests?.loose);
  if (!response.ok && requests?.strict) {
    const problem = (await response.clone().json().catch(() => null)) as Json;
    if (refusesSchema(problem)) {
      strict = true;
      response = await call(requests.strict);
    }
  }
  if (!response.ok) throw await apiError(response);
  if (!strict) return response;
  const mended = mendedCompletion((await response.json()) as Json);
  const headers = new Headers(response.headers);
  for (const header of STALE_HEADERS) headers.delete(header);
  return new Response(JSON.stringify(mended), { status: response.status, statusText: response.statusText, headers });
};

/**
 * `model` through the relay, as an OpenAI-compatible provider: the name is the page's to show, the
 * server answers with the workspace's whatever it says. The URL is absolute: the provider builds it
 * with `new URL`.
 */
function relayModel(model: string): LanguageModel {
  const relay = createOpenAICompatible({
    name: "keasy",
    baseURL: new URL(`${API}/v1/ai`, window.location.origin).href,
    fetch: relayFetch,
    includeUsage: true,
    supportsStructuredOutputs: true,
  });
  return relay.chatModel(model);
}

/**
 * The model, for a screen that asks it: the external one when the workspace has one, else the page's.
 * A call made while the page's model loads waits for the load.
 */
export function useModel(): LanguageModel {
  const external = useExternalModel();
  const name = external?.model;
  return useMemo(() => {
    if (typeof window === "undefined") return localModel();
    if (name) return relayModel(name);
    provide();
    return localModel();
  }, [name]);
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
 *
 * A workspace with an external model downloads nothing. Which it has is asked first, without
 * suspending the screen that opened (a graph's layout holds no boundary): the answer is cached for
 * the screens that ask, and a server that cannot say leaves the page's model to load, as before.
 */
export function usePreloadModel(): void {
  const queryClient = useQueryClient();
  const loadModel = useLoadModel();
  useEffect(() => {
    let live = true;
    queryClient.fetchQuery(modelQuery).then(
      ({ external }) => live && !external && loadModel(),
      () => live && loadModel(),
    );
    return () => {
      live = false;
    };
  }, [queryClient, loadModel]);
}

/**
 * How the model stands in this page: what Ask and the assistant show until it is ready. An external
 * model is ready at once, with nothing to load; the page's says its download and load.
 */
export function useModelLoad(): ModelLoad {
  const external = useExternalModel();
  const local = useSyncExternalStore(
    useCallback((listener: () => void) => watchLocalModel(undefined, listener), []),
    () => localModelLoad(),
    () => localModelLoad(),
  );
  return external ? READY : local;
}

const READY: ModelLoad = { state: "ready" };
