import { HOST_MS } from "@fossil-lang/types";
import { describe, expect, it } from "vitest";

import { bounds } from "./api/spec";
import { DEADLINE_MS } from "./deadline";

describe("the deadlines that must agree", () => {
  it("gives fossil's host deadline room inside the browser's", () => {
    expect(DEADLINE_MS).toBeGreaterThanOrEqual(HOST_MS);
  });

  it("has the server name itself before fossil or the browser gives up", () => {
    expect(bounds.request_ms).toBeLessThan(HOST_MS);
    expect(bounds.request_ms).toBeLessThan(DEADLINE_MS);
  });
});
