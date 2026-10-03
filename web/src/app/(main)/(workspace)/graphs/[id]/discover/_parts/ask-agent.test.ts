import { describe, expect, it } from "vitest";
import { askInstructions, ROWS, sample } from "./ask-agent";

describe("the Ask agent", () => {
  it("reasons over the live schema it is given, joining on the key the manifest names", () => {
    const instructions = askInstructions('CREATE TABLE "graphs/7"."Person" (…)', "vid");
    expect(instructions).toContain('"graphs/7"."Person"');
    expect(instructions).toContain('s."vid"');
    expect(instructions).not.toContain("dense_id");
    expect(instructions).toContain(`LIMIT\` of at most ${ROWS}`);
  });

  it("reads back a sample of the rows, cut to a budget", () => {
    const rows = Array.from({ length: 500 }, (_, n) => ({ n, s: "x".repeat(40) }));
    const read = sample(rows);
    expect(read.length).toBeLessThanOrEqual(4003);
    expect(read).toContain('"n":0');
    expect(read).not.toContain('"n":31');
  });
});
