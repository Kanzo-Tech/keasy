import { describe, expect, it, vi } from "vitest";

vi.mock("client-only", () => ({}));
vi.mock("./client", () => ({ http: {} }));

const { sseFailure } = await import("./sse");

describe("an SSE error frame", () => {
  it("is the server's body when it parses", () => {
    const body = { code: "llm/silent", title: "t", detail: "d", data: { after: 30_000 } };
    expect(sseFailure({ event: "error", data: JSON.stringify(body) })).toEqual(body);
  });

  it("is still a failure, llm/failed with its own text, when it does not", () => {
    expect(sseFailure({ event: "error", data: "oops{" })).toMatchObject({ code: "llm/failed", detail: "oops{" });
  });

  it("is nothing for any other frame", () => {
    expect(sseFailure({ event: "delta", data: "x" })).toBeNull();
  });
});
