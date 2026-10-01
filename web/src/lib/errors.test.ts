import { FossilError, isFossilError } from "@fossil-lang/types";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { copyOf, pageOf, toProblem } from "./errors";

const overBudget = () =>
  FossilError.of(
    "run/over-budget",
    { budget: 2048, consumer: "join", requested: 4096, reserved: 0 },
    "the join asked for 4096 bytes past a 2048-byte budget",
  );

describe("a failure, shown", () => {
  it("is fossil's problem whole when fossil raised it, branched on by code", () => {
    const err = overBudget();
    expect(isFossilError(err, "run/over-budget")).toBe(true);
    const shown = toProblem(err);
    expect(shown.code).toBe("run/over-budget");
    expect(shown.data).toEqual({ budget: 2048, consumer: "join", requested: 4096, reserved: 0 });
    expect(pageOf(shown.code)).toContain("run/over-budget");
  });

  it("says a run too large for the browser in keasy's words", () => {
    expect(copyOf("run/over-budget")).toMatchObject({ title: "Too large for the browser" });
  });

  it("leaves a fossil code with no entry in fossil's own words", () => {
    expect(copyOf("corpus/unreadable")).toBeUndefined();
  });

  it("is the server's body for a refusal, and has no page", () => {
    const err = new ApiError({ code: "resource/in-use", title: "Still in use", detail: "used by sink", data: { dependents: ["sink"] } }, 409);
    expect(toProblem(err)).toEqual({ code: "resource/in-use", title: "Still in use", detail: "used by sink", data: { dependents: ["sink"] } });
    expect(pageOf("resource/in-use")).toBeUndefined();
  });

  it("names anything else by the code it is given", () => {
    expect(toProblem(new Error("boom"), "query/failed")).toMatchObject({ code: "query/failed", detail: "boom" });
  });
});
