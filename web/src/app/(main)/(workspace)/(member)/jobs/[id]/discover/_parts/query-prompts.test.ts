import { describe, expect, it } from "vitest";
import { parsePlan, queryRequest } from "./query-prompts";

describe("the query prompts", () => {
  it("reads a fenced JSON plan", () => {
    const plan = parsePlan('```json\n{"sql":"SELECT 1","explanation":"One.","reasoning":"r"}\n```');
    expect(plan).toEqual({ sql: "SELECT 1", answer: "One.", reasoning: "r" });
  });

  it("keeps an answer that is not the JSON asked for as prose", () => {
    expect(parsePlan(" just words ")).toEqual({ sql: null, answer: "just words", reasoning: "" });
  });

  it("sends only the latest window of history, then the question", () => {
    const history = Array.from({ length: 14 }, (_, n) => ({
      role: n % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `m${n}`,
    }));
    const { messages } = queryRequest("DDL", history, "q");
    expect(messages).toHaveLength(11);
    expect(messages[0]?.content).toBe("m4");
    expect(messages.at(-1)).toEqual({ role: "user", content: "q" });
  });
});
