import spec from "@keasy/api/openapi.json";
import { describe, expect, it } from "vitest";

import { API, MODEL_CALLS } from "./routes";

describe("the model calls' path", () => {
  it("is where the server serves every AI route", () => {
    const ai = Object.entries(spec.paths as Record<string, Record<string, { tags?: string[] }>>)
      .filter(([, operations]) => Object.values(operations).some((o) => o.tags?.includes("AI")))
      .map(([path]) => `${API}${path}`);
    expect(ai.length).toBeGreaterThan(0);
    for (const path of ai) expect(path.startsWith(`${MODEL_CALLS}/`)).toBe(true);
  });
});
