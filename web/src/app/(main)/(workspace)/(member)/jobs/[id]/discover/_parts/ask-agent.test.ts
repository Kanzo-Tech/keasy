import { describe, expect, it } from "vitest";
import { askInstructions, sample } from "./ask-agent";

describe("the Ask agent", () => {
  it("reasons over the live schema it is given, joining on the key the manifest names", () => {
    const instructions = askInstructions('CREATE TABLE "jobs/7"."Person" (…)', "vid");
    expect(instructions).toContain('"jobs/7"."Person"');
    expect(instructions).toContain('s."vid"');
    expect(instructions).not.toContain("dense_id");
  });

  it("reads back a sample of the rows, cut to a budget", () => {
    const rows = Array.from({ length: 500 }, (_, n) => [n, "x".repeat(40)]);
    const read = sample({ columns: ["n", "s"], rows, truncated: false });
    expect(read.length).toBeLessThanOrEqual(4003);
    expect(read).toContain('"n":0');
    expect(read).not.toContain('"n":31');
  });
});
