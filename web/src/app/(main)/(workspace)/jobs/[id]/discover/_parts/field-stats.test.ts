import { describe, expect, it } from "vitest";
import { columnsOf } from "./field-stats";

describe("field-stats", () => {
  it("finds a table's columns by name", () => {
    const tables = [{ name: "Person", fields: [], columns: ["dense_id", "country"] }];
    expect(columnsOf(tables, "Person")).toEqual(["dense_id", "country"]);
    expect(columnsOf(tables, "Place")).toEqual([]);
  });
});
