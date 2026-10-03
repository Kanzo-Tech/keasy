import { createGateway } from "@kanzo-tech/llm";
import { describe, expect, it, vi } from "vitest";
import { coded } from "@/lib/errors";
import { describeFiles, suggestQuestions, writeProgram } from "./assistant-prompts";

const relay = vi.hoisted(() => ({ body: "" }));

vi.mock("@/lib/ai", () => ({
  gateway: createGateway({
    baseURL: "http://relay.test/v1/ai",
    fetch: async () => new Response(relay.body, { headers: { "content-type": "text/event-stream" } }),
  }),
}));

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** The event the server's relay ends a quiet answer with (`server/src/routes/ai.rs`, `error_event`). */
const SILENT =
  "\n\ndata: " +
  JSON.stringify({
    error: {
      code: "gateway/silent",
      title: "The AI gateway did not answer in time",
      detail: "the AI gateway went silent mid-answer",
      data: { after: 25_000 },
      message: "the AI gateway went silent mid-answer",
    },
  }) +
  "\n\n";

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
    const text = describeFiles([
      { uri: "@c/people.csv", columns: [{ name: "email", primitive: "string" }] },
    ] as never);
    expect(text).toBe("File: @c/people.csv\nColumns:\n  - email (string)\n\n");
  });
});

describe("an answer the relay ends as gateway/silent", () => {
  const signal = new AbortController().signal;

  it("fails the suggestions with the relay's code, not as none", async () => {
    relay.body = chunk('[{"question":') + SILENT;
    const failure = await failureOf(suggestQuestions("people", [], signal));
    expect(coded(failure, "llm/failed")).toMatchObject({ code: "gateway/silent" });
  });

  it("fails a program it cut short, rather than passing the part written", async () => {
    relay.body = chunk('{"program":"type { Person } := ') + SILENT;
    const failure = await failureOf(writeProgram("people", ["Who?"], [], signal));
    expect(coded(failure, "llm/failed")).toMatchObject({ code: "gateway/silent" });
  });
});
