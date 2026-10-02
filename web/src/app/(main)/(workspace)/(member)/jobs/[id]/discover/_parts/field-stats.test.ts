import { describe, expect, it } from "vitest";
import type { Catalog, VertexTable } from "@/lib/fossil/corpus";
import { bookkeeping, columnsOf, graphKey } from "./field-stats";

const PERSON: VertexTable = {
  name: "Person",
  path: "vertex/Person.parquet",
  key: "dense_id",
  identity: "subject",
  record_count: 1000,
  properties: [
    { name: "dense_id", type: "UBIGINT", role: "address", nullable: false },
    { name: "subject", type: "VARCHAR", role: "identity", nullable: false },
    { name: "country", type: "VARCHAR", nullable: true },
    { name: "lon", type: "DOUBLE", nullable: true },
  ],
};

describe("field-stats", () => {
  it("hides every column fossil gave a role, and no other", () => {
    expect(bookkeeping(PERSON)).toEqual(["dense_id", "subject"]);
  });

  it("reads the graph's key from the address column, and refuses a corpus with no vertex table", () => {
    const catalog = (vertex_tables: VertexTable[]): Catalog => ({ vertex_tables, edge_tables: [] });
    expect(graphKey(catalog([{ ...PERSON, key: "vid" }]))).toBe("vid");
    expect(() => graphKey(catalog([]))).toThrow();
  });

  it("finds a table's columns by name", () => {
    const tables = [{ name: "Person", count: 1, fields: [], columns: ["dense_id", "country"] }];
    expect(columnsOf(tables, "Person")).toEqual(["dense_id", "country"]);
    expect(columnsOf(tables, "Place")).toEqual([]);
  });
});
