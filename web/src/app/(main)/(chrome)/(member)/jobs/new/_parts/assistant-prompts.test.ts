import { describe, expect, it } from "vitest";
import { describeFiles } from "./assistant-prompts";

describe("the assistant prompts", () => {
  it("shows the model each file with its columns and types", () => {
    const text = describeFiles([
      { uri: "@c/people.csv", columns: [{ name: "email", primitive: "string" }] },
    ] as never);
    expect(text).toBe("File: @c/people.csv\nColumns:\n  - email (string)\n\n");
  });
});
