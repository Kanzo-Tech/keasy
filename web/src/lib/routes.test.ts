import spec from "@keasy/api/openapi.json";
import { describe, expect, it } from "vitest";

import { API, MODEL_CALLS } from "./routes";

describe("the model calls' path", () => {
  // The BFF forwards a request by the longest mount it is under, so a server route there would
  // reach the AI gateway instead.
  it("is a mount of its own, which no route of the server's lies under", () => {
    const shadowed = Object.keys(spec.paths)
      .map((path) => `${API}${path}`)
      .filter((path) => path === MODEL_CALLS || path.startsWith(`${MODEL_CALLS}/`));
    expect(shadowed).toEqual([]);
  });
});
