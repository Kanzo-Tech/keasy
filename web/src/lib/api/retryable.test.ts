import { describe, expect, it } from "vitest";
import { Problem } from "@kanzo-tech/kernel";
import { HttpError, retryable } from "@keasy/api";

const coded = (code: string, status?: number) => new Problem(code, "", {}, { status });

describe("retryable", () => {
  it("asks again when nothing answered: a network failure, a deadline", () => {
    expect(retryable(new TypeError("Failed to fetch"))).toBe(true);
    expect(retryable(coded("server/silent"))).toBe(true);
  });

  it("asks again on 408, 429 and every 5xx, the forwarder's api/unreachable among them", () => {
    expect(retryable(coded("api/unreachable", 502))).toBe(true);
    for (const status of [408, 429, 500, 503, 504]) expect(retryable(new HttpError("", status))).toBe(true);
  });

  it("never asks again on another 4xx, whether or not it named a code", () => {
    expect(retryable(coded("graph/ended", 409))).toBe(false);
    expect(retryable(coded("organization/denied", 403))).toBe(false);
    for (const status of [400, 401, 403, 404]) expect(retryable(new HttpError("", status))).toBe(false);
  });
});
