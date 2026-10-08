import { createGateway } from "@kanzo-tech/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coded } from "@/lib/errors";
import { describeFiles, suggestQuestions, writeProgram } from "./assistant-prompts";

const model = vi.hoisted(() => ({ written: "" }));

/** A gateway that answers with what `model.written` holds, then sends nothing more. */
vi.mock("@/lib/ai", () => ({
  gateway: createGateway({
    baseURL: "http://gateway.test/api/ai",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({ start: (body) => body.enqueue(new TextEncoder().encode(model.written)) }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  }),
}));

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

async function failureOf(stream: AsyncIterable<unknown>): Promise<unknown> {
  try {
    for await (const value of stream) void value;
  } catch (error) {
    return error;
  }
  throw new Error("the stream ended without failing");
}

describe("the assistant prompts", () => {
  it("shows the model each file with its columns and types", () => {
    const text = describeFiles([{ key: "@c/people.csv", etag: "", columns: [{ name: "email", primitive: "string" }] }]);
    expect(text).toBe("File: @c/people.csv\nColumns:\n  - email (string)\n\n");
  });
});

describe("an answer the model stops writing", () => {
  const signal = new AbortController().signal;
  afterEach(() => vi.useRealTimers());

  it("fails the suggestions as ai/silent, not as none", async () => {
    vi.useFakeTimers();
    model.written = chunk('[{"question":');
    const failure = failureOf(suggestQuestions("people", [], signal));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(coded(await failure, "llm/failed")).toMatchObject({ code: "ai/silent" });
  });

  it("fails a program it cut short, rather than passing the part written", async () => {
    vi.useFakeTimers();
    model.written = chunk('{"program":"type { Person } := ');
    const failure = failureOf(writeProgram("people", ["Who?"], [], signal));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(coded(await failure, "llm/failed")).toMatchObject({ code: "ai/silent" });
  });
});
