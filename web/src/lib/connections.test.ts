import { describe, expect, it } from "vitest";
import { schemaOf } from "./api/spec";
import { CLOUDS, reference } from "./connections";

describe("a listed file's reference", () => {
  it("reads the bucket key as a URL on the connection's bucket", () => {
    expect(reference({ name: "raw", url: "s3://bucket/data/in/" }, "data/in/x.csv")).toBe("@raw/x.csv");
    expect(reference({ name: "raw", url: "s3://bucket" }, "data/x.csv")).toBe("@raw/data/x.csv");
  });
});

describe("the clouds", () => {
  it("group every credential kind the contract publishes, each once", () => {
    const published = schemaOf("SecretSpec").oneOf?.map((b) => b.properties?.kind?.enum?.[0]);
    const grouped = CLOUDS.flatMap((c) => c.methods.map((m) => m.kind));
    expect([...grouped].sort()).toEqual([...(published ?? [])].sort());
  });
});
