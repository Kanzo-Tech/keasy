import { FossilError, isFossilError } from "@fossil-lang/types";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { copyOf, pageOf, toProblem } from "./errors";

const overBudget = () =>
  FossilError.from({
    code: "run/over-budget",
    title: "Over budget",
    detail: "the join asked for 4096 bytes past a 2048-byte budget",
    severity: "error",
    data: { budget: 2048, consumer: "join", requested: 4096, reserved: 0 },
  });

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

describe("a failure's cause", () => {
  it("is kept one level down, coded when it can be", () => {
    const store = new ApiError({ code: "store/silent", title: "The store did not answer in time", detail: "STS", data: { after: 10_000 } }, 504);
    const shown = toProblem(new Error("could not open the corpus", { cause: store }));
    expect(shown).toMatchObject({ code: "web/unknown", cause: { code: "store/silent", data: { after: 10_000 } } });
  });

  it("is a foreign error's own words when it has no code", () => {
    expect(toProblem(new ApiError({ code: "gateway/unreachable", title: "t", detail: "d", data: {} }, 502, { cause: new TypeError("Failed to fetch") })).cause).toEqual({
      name: "TypeError",
      detail: "Failed to fetch",
    });
  });
});

describe("a library's coded failure", () => {
  it("is keyed by its code, its data kept", () => {
    const silent = Object.assign(new Error("The model sent nothing for 30 s"), { code: "ai/silent", data: { after: 30_000 } });
    expect(toProblem(silent)).toMatchObject({ code: "ai/silent", data: { after: 30_000 } });
  });

  it("is read in fossil's grammar, digits and all", () => {
    const code = (c: string) => toProblem(Object.assign(new Error("x"), { code: c })).code;
    expect(code("source/not-utf8")).toBe("source/not-utf8");
    expect(code("source/-utf8")).toBe("web/unknown");
    expect(code("Source/x")).toBe("web/unknown");
  });

  it("keeps the server's code when the AI SDK carries its answer as the response body", () => {
    const refused = Object.assign(new Error("Gateway Timeout"), {
      responseBody: JSON.stringify({ code: "gateway/silent", title: "t", detail: "d", data: { after: 30_000 } }),
    });
    expect(toProblem(refused, "llm/failed")).toMatchObject({ code: "gateway/silent" });
    expect(toProblem(Object.assign(new Error("x"), { responseBody: "<html>" }), "llm/failed").code).toBe("llm/failed");
  });

  it("keeps the relay's code from the error event that ended a streamed answer", () => {
    // What the openai-compatible parser hands over for `data: {"error": {…}}`: the protocol's four
    // fields, keasy's `title` and `data` already dropped.
    const event = { message: "the AI gateway went silent mid-answer", code: "gateway/silent" };
    expect(toProblem(event, "llm/failed")).toEqual({
      code: "gateway/silent",
      title: "The AI gateway did not answer in time.",
      detail: "the AI gateway went silent mid-answer",
    });
  });

  it("leaves a provider's error event to the fallback, in its own words", () => {
    const event = { message: "The server is overloaded", type: "server_error", code: "overloaded" };
    expect(toProblem(event, "llm/failed")).toMatchObject({ code: "llm/failed", detail: "The server is overloaded" });
  });
});

describe("a host failure fossil wrapped", () => {
  it("keeps keasy's code and data under fossil's", () => {
    const silent = new ApiError({ code: "store/silent", title: "The store did not answer in time", detail: "STS", data: { after: 10_000 } }, 504);
    const wrapped = FossilError.of("storage/host-refused", { scope: "job x" }, { cause: silent });
    expect(toProblem(wrapped)).toMatchObject({
      code: "storage/host-refused",
      cause: { name: "ApiError", code: "store/silent", data: { after: 10_000 } },
    });
  });

  it("keeps keasy's code in a stored problem, a level further down", () => {
    const missing = new ApiError({ code: "job/not-found", title: "Job not found", detail: "No such job", data: {} }, 404);
    const refused = FossilError.of("storage/host-refused", { scope: "job x" }, { cause: missing });
    const unread = FossilError.of("document/unread", { documents: ["people.csv"] }, { cause: refused.problem });
    const stored = JSON.parse(JSON.stringify(unread.problem)) as typeof unread.problem;
    expect(toProblem(FossilError.from(stored))).toMatchObject({
      code: "document/unread",
      cause: { code: "storage/host-refused", cause: { code: "job/not-found" } },
    });
  });
});
