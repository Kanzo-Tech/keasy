import { describe, expect, it } from "vitest";
import { parseScript, parseSuggestions } from "./assistant-prompts";

describe("the assistant prompts", () => {
  it("takes a program out of its fence", () => {
    expect(parseScript("```fossil\nA := io.csv(\"@c/a.csv\")\n```")).toBe('A := io.csv("@c/a.csv")');
  });

  it("suggests nothing when the answer does not parse", () => {
    expect(parseSuggestions("nope")).toEqual([]);
  });
});
