import { describe, expect, it } from "vitest";
import { reference } from "./connections";

describe("a listed file's reference", () => {
  it("reads the bucket key as a URL on the connection's bucket", () => {
    expect(reference({ name: "raw", url: "s3://bucket/data/in/" }, "data/in/x.csv")).toBe("@raw/x.csv");
    expect(reference({ name: "raw", url: "s3://bucket" }, "data/x.csv")).toBe("@raw/data/x.csv");
  });
});
