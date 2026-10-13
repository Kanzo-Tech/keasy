import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { coded } from "@/lib/errors";
import { describeFiles, suggestQuestions, writeProgram } from "./assistant-prompts";

/** A page that cannot run the model: every call fails as `localModel` fails one without WebGPU. */
const unavailable = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw Object.assign(new Error("This browser cannot run the model: it has no WebGPU"), {
        code: "ai/unavailable",
        data: { reason: "webgpu" },
      });
    },
  });

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

describe("a model that cannot answer", () => {
  const signal = new AbortController().signal;

  it("fails the suggestions with its code, not as none", async () => {
    const failure = failureOf(suggestQuestions(unavailable(), "people", [], signal));
    expect(coded(await failure, "llm/failed")).toMatchObject({ code: "ai/unavailable" });
  });

  it("fails the program with its code, rather than passing nothing written", async () => {
    const failure = failureOf(writeProgram(unavailable(), "people", ["Who?"], [], signal));
    expect(coded(await failure, "llm/failed")).toMatchObject({ code: "ai/unavailable" });
  });
});
