import { FossilError, isFossilError } from "@fossil-lang/types";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { coded, copyOf, fieldProblem, pageOf, wireOf } from "./errors";

const overBudget = () =>
  FossilError.from({
    code: "run/over-budget",
    title: "Over budget",
    detail: "the join asked for 4096 bytes past a 2048-byte budget",
    severity: "error",
    data: { budget: 2048, consumer: "join", requested: 4096, reserved: 0 },
  });

describe("a failure, kept as JSON", () => {
  it("is fossil's problem whole when fossil raised it, branched on by code", () => {
    const err = overBudget();
    expect(isFossilError(err, "run/over-budget")).toBe(true);
    const shown = wireOf(err);
    expect(shown.code).toBe("run/over-budget");
    expect(shown.data).toEqual({ budget: 2048, consumer: "join", requested: 4096, reserved: 0 });
    expect(pageOf(shown.code)).toContain("run/over-budget");
  });

  it("says a run too large for the browser in keasy's words", () => {
    expect(copyOf("run/over-budget")).toMatchObject({ title: "Too large for the browser" });
    expect(copyOf("run/over-budget", { budget: 2 * 2 ** 30 })?.detail).toContain("(2 GiB)");
    expect(copyOf("run/over-budget", { budget: 1.5 * 2 ** 30 })?.detail).toContain("(1.5 GiB)");
    expect(copyOf("run/over-budget")?.detail).not.toContain("GiB");
  });

  it("names the missing file of a source from the location it carries", () => {
    expect(copyOf("source/not-found")).toMatchObject({ title: "The source names no file" });
    expect(copyOf("source/not-found", { location: "s3://lake/in/users.csv" })?.detail).toContain("s3://lake/in/users.csv");
    expect(copyOf("source/not-found")?.detail).not.toContain("undefined");
  });

  it("leaves a fossil code with no entry in fossil's own words", () => {
    expect(copyOf("corpus/unreadable")).toBeUndefined();
  });

  it("is the server's body for a refusal, and has no page", () => {
    const err = new ApiError({ code: "resource/in-use", title: "Still in use", detail: "used by sink", data: { dependents: ["sink"] } }, 409);
    expect(wireOf(err)).toEqual({ code: "resource/in-use", title: "Still in use", detail: "used by sink", data: { dependents: ["sink"] } });
    expect(pageOf("resource/in-use")).toBeUndefined();
  });

  it("names anything else by the code it is given", () => {
    expect(wireOf(new Error("boom"), "query/failed")).toMatchObject({ code: "query/failed", detail: "boom" });
  });
});

describe("a failure's cause", () => {
  it("is kept one level down, coded when it can be", () => {
    const store = new ApiError({ code: "store/silent", title: "The store did not answer in time", detail: "STS", data: { after: 10_000 } }, 504);
    const shown = wireOf(new Error("could not open the corpus", { cause: store }));
    expect(shown).toMatchObject({ code: "web/unknown", cause: { code: "store/silent", data: { after: 10_000 } } });
  });

  it("is a foreign error's own words when it has no code", () => {
    expect(wireOf(new ApiError({ code: "store/refused", title: "t", detail: "d", data: {} }, 502, { cause: new TypeError("Failed to fetch") })).cause).toEqual({
      name: "TypeError",
      detail: "Failed to fetch",
    });
  });
});

describe("a library's coded failure", () => {
  it("is keyed by its code, its data kept", () => {
    const silent = Object.assign(new Error("The model sent nothing for 30 s"), { code: "ai/silent", data: { after: 30_000 } });
    expect(coded(silent)).toMatchObject({ code: "ai/silent", data: { after: 30_000 } });
  });

  it("is read in fossil's grammar, digits and all", () => {
    const code = (c: string) => coded(Object.assign(new Error("x"), { code: c })).code;
    expect(code("source/not-utf8")).toBe("source/not-utf8");
    expect(code("source/-utf8")).toBe("web/unknown");
    expect(code("Source/x")).toBe("web/unknown");
  });

  it("leaves a provider's error event to the fallback, in its own words", () => {
    const event = { message: "The server is overloaded", type: "server_error", code: "overloaded" };
    expect(coded(event, "llm/failed")).toMatchObject({ code: "llm/failed", message: "The server is overloaded" });
  });
});

describe("a host failure fossil wrapped", () => {
  it("keeps keasy's code and data under fossil's", () => {
    const silent = new ApiError({ code: "store/silent", title: "The store did not answer in time", detail: "STS", data: { after: 10_000 } }, 504);
    const wrapped = FossilError.of("storage/host-refused", { scope: "graph x" }, { cause: silent });
    expect(wireOf(wrapped)).toMatchObject({
      code: "storage/host-refused",
      cause: { name: "ApiError", code: "store/silent", data: { after: 10_000 } },
    });
  });

  it("keeps keasy's code in a stored problem, a level further down", () => {
    const missing = new ApiError({ code: "graph/not-found", title: "Graph not found", detail: "No such graph", data: {} }, 404);
    const refused = FossilError.of("storage/host-refused", { scope: "graph x" }, { cause: missing });
    const unread = FossilError.of("document/unread", { documents: ["people.csv"] }, { cause: refused.problem });
    const stored = JSON.parse(JSON.stringify(unread.problem)) as typeof unread.problem;
    expect(wireOf(FossilError.from(stored))).toMatchObject({
      code: "document/unread",
      cause: { code: "storage/host-refused", cause: { code: "graph/not-found" } },
    });
  });
});

describe("a refusal about one field", () => {
  it("names the field and says it in keasy's words", () => {
    const taken = new ApiError({ code: "graph/folder-taken", title: "Folder taken", detail: "people is held", data: { field: "folder" } }, 409);
    expect(fieldProblem(taken)).toEqual({ field: "folder", message: "Another graph writes to this folder already." });
  });

  it("falls back to the server's detail for a code keasy has no words for", () => {
    const misspelled = new ApiError({ code: "request/invalid", title: "Invalid", detail: "a name cannot hold '/'", data: { field: "name" } }, 400);
    expect(fieldProblem(misspelled)).toEqual({ field: "name", message: "a name cannot hold '/'" });
  });

  it("is null for a refusal about no field, or a failure that is not the server's", () => {
    expect(fieldProblem(new ApiError({ code: "server/internal", title: "t", detail: "d", data: {} }, 500))).toBeNull();
    expect(fieldProblem(new ApiError({ code: "request/invalid", title: "t", detail: "d", data: { field: null } }, 400))).toBeNull();
    expect(fieldProblem(new Error("boom"))).toBeNull();
  });
});
