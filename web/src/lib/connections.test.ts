import { describe, expect, it } from "vitest";
import { reference } from "./connections";

describe("a listed file's reference", () => {
  it("is relative to the connection's prefix, written once", () => {
    expect(reference({ name: "raw", url: "s3://bucket/data/in" }, "data/in/x.csv")).toBe("@raw/x.csv");
  });

  it("is the whole key for a connection on the bucket's root", () => {
    expect(reference({ name: "raw", url: "s3://bucket" }, "data/x.csv")).toBe("@raw/data/x.csv");
  });
});
