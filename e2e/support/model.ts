import type { Page } from "@playwright/test";

/**
 * **A model double in the page.** The model runs in the browser, on WebGPU (`web/src/lib/ai.ts`), and
 * CI's Chromium has none, so the scenarios that need an answer put a scripted `LanguageModel` (the AI
 * SDK's v4 interface, written by hand) on `window.__keasyModelDouble` before the page loads; the web
 * asks it in place of WebLLM, and only in a development build — the stack `make e2e` runs. Every call
 * is recorded, its prompt flattened, for a test to read what the model was told (`promptsOf`).
 */

/** What one call answers. */
export type Reply =
  /** The whole answer: a structured one is its JSON. A stream writes it a word at a time. */
  | { text: string }
  /** The call fails with `fail`'s words — a stream after writing `after` first. */
  | { fail: string; after?: string }
  /** The call never answers, until it is stopped. */
  | { hang: true };

/** The reply to the first call whose prompt — system and user, flattened — contains `when`. */
export interface Rule {
  when: string;
  reply: Reply;
  /** Answers one call, then gives way to the next rule that matches. */
  once?: boolean;
}

export interface Script {
  rules: Rule[];
  /** The load fails with these words, as WebLLM's does when a shard cannot be downloaded. */
  load?: { fail: string };
}

/**
 * Ask's offers, which its panel asks for as soon as the model is ready: none, so no pill and no
 * failure stand beside what a scenario asserts. A scenario's own rule for them comes first.
 */
const NO_OFFERS: Rule = { when: "different from one another", reply: { text: JSON.stringify({ elements: [] }) } };

/** Puts the double on every page this one loads from now on. */
export async function useModelDouble(page: Page, script: Script): Promise<void> {
  await page.addInitScript(install, { ...script, rules: [...script.rules, NO_OFFERS] });
}

/** Every prompt the double was asked, in order. */
export function promptsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __keasyModelCalls?: string[] }).__keasyModelCalls ?? []);
}

/** Runs in the page, before anything of it: serialized by Playwright, so nothing from outside. */
function install({ rules, load }: Script) {
  type Part = { type: string; text?: string };
  type Options = { prompt: { content: string | Part[] }[]; abortSignal?: AbortSignal };
  const calls: string[] = [];
  const spent = new Set<Rule>();
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const replyTo = (options: Options): Reply => {
    const prompt = options.prompt
      .flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.map((p) => p.text ?? "")))
      .join("\n");
    calls.push(prompt);
    const rule = rules.find((r) => !spent.has(r) && prompt.includes(r.when));
    if (rule?.once) spent.add(rule);
    return rule?.reply ?? { fail: `The model double has no reply for: ${prompt.slice(0, 120)}` };
  };
  const stopped = (signal: AbortSignal | undefined) =>
    new Promise<never>((_, reject) =>
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Stopped", "AbortError")), { once: true }),
    );
  const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];

  const model = {
    specificationVersion: "v4",
    provider: "e2e",
    modelId: "double",
    supportedUrls: {},
    async doGenerate(options: Options) {
      const reply = replyTo(options);
      if ("hang" in reply) return stopped(options.abortSignal);
      if ("fail" in reply) throw new Error(reply.fail);
      return {
        content: [{ type: "text", text: reply.text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    async doStream(options: Options) {
      const reply = replyTo(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "t" });
            if ("hang" in reply) {
              stopped(options.abortSignal).catch((reason: unknown) => controller.error(reason));
              return;
            }
            const text = "fail" in reply ? (reply.after ?? "") : reply.text;
            for (const delta of words(text)) controller.enqueue({ type: "text-delta", id: "t", delta });
            if ("fail" in reply) {
              controller.enqueue({ type: "error", error: new Error(reply.fail) });
            } else {
              controller.enqueue({ type: "text-end", id: "t" });
              controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
            }
            controller.close();
          },
        }),
      };
    },
  };

  const page = window as unknown as { __keasyModelDouble?: unknown; __keasyModelCalls?: string[] };
  page.__keasyModelDouble = { model, load: load ? () => Promise.reject(new Error(load.fail)) : undefined };
  page.__keasyModelCalls = calls;
}
