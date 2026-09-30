import { describe, expect, it } from "vitest";
import { overBudget, runFailure } from "./jobs";

describe("a run refused as too large", () => {
  it("is recognised by the error's name, and keeps fossil's message as the detail", () => {
    const err = new Error("the run needs more memory than the executor's 2048 MiB budget. Nothing was written.");
    err.name = "OverBudget";
    expect(overBudget(runFailure(err))).toBe(err.message);
  });

  it("leaves any other failure as its message", () => {
    const text = runFailure(new Error("the run needs more memory"));
    expect(text).toBe("the run needs more memory");
    expect(overBudget(text)).toBeNull();
  });
});
