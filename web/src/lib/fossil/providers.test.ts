import { describe, expect, it } from "vitest";
import { providerFor } from "./providers";

const providers = [
  { name: "csv", extensions: ["csv"], kind: "data" as const },
  { name: "shex", extensions: ["shex"], kind: "schema" as const },
  { name: "rdf", extensions: ["ttl"], kind: "both" as const },
];
const paths = ["a.CSV", "b.shex", "c.ttl", "d.txt", "noext"];

describe("providerFor", () => {
  it("finds the provider of that kind, by case-insensitive extension", () => {
    expect(paths.map((p) => providerFor(p, "data", providers)?.name)).toEqual([
      "csv",
      undefined,
      "rdf",
      undefined,
      undefined,
    ]);
    expect(paths.filter((p) => providerFor(p, "schema", providers))).toEqual(["b.shex", "c.ttl"]);
  });

  it("finds nothing without providers", () => {
    expect(providerFor("a.csv", "data", [])).toBeUndefined();
  });
});
