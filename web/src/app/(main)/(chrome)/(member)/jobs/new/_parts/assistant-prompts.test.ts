import { describe, expect, it } from "vitest";
import { toProblem } from "@/lib/errors";
import { parseScript, parseSuggestions } from "./assistant-prompts";

describe("the assistant prompts", () => {
  it("takes a program out of its fence", () => {
    expect(parseScript("```fossil\nA := io.csv(\"@c/a.csv\")\n```")).toBe('A := io.csv("@c/a.csv")');
  });

  it("reads the suggested questions", () => {
    const q = { id: "q1", question: "Who?", rationale: "r" };
    expect(parseSuggestions(JSON.stringify({ competency_questions: [q] }))).toEqual([q]);
  });

  it("fails as llm/unparseable when the answer does not parse, never as no suggestions", () => {
    for (const answer of ["nope", '{"other": 1}']) {
      let thrown: unknown;
      try {
        parseSuggestions(answer);
      } catch (err) {
        thrown = err;
      }
      expect(toProblem(thrown)).toMatchObject({ code: "llm/unparseable", detail: answer });
    }
  });
});
