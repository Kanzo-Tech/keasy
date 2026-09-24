import { describe, expect, it } from "vitest";
import { readableFiles } from "@/lib/utils";

const providers = [
  { name: "csv", extensions: ["csv"], kind: "data" as const },
  { name: "shex", extensions: ["shex"], kind: "schema" as const },
  { name: "rdf", extensions: ["ttl"], kind: "both" as const },
];
const files = ["a.CSV", "b.shex", "c.ttl", "d.txt", "noext"].map((path) => ({ path }));

describe("readableFiles", () => {
  it("keeps the files a provider of that kind reads, by case-insensitive extension", () => {
    expect(readableFiles(files, providers, "data").map((f) => f.path)).toEqual(["a.CSV", "c.ttl"]);
    expect(readableFiles(files, providers, "schema").map((f) => f.path)).toEqual(["b.shex", "c.ttl"]);
  });

  it("reads nothing without providers", () => {
    expect(readableFiles(files, [], "data")).toEqual([]);
  });
});
