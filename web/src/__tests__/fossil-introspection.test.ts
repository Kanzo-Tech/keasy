import { describe, expect, it } from "vitest";
import {
  buildInferredDescriptor,
  duckdbTypeToFossilPrimitive,
  extractSourceRefs,
} from "@/lib/fossil/introspection";

describe("duckdbTypeToFossilPrimitive", () => {
  it("maps integer family to Integer", () => {
    for (const t of ["INTEGER", "BIGINT", "INT", "SMALLINT", "TINYINT", "HUGEINT"]) {
      expect(duckdbTypeToFossilPrimitive(t)).toBe("Integer");
    }
  });

  it("maps float family + DECIMAL(p,s) to Float", () => {
    for (const t of ["DOUBLE", "FLOAT", "REAL", "DECIMAL(10,2)"]) {
      expect(duckdbTypeToFossilPrimitive(t)).toBe("Float");
    }
  });

  it("maps temporal + boolean types", () => {
    expect(duckdbTypeToFossilPrimitive("BOOLEAN")).toBe("Bool");
    expect(duckdbTypeToFossilPrimitive("DATE")).toBe("Date");
    expect(duckdbTypeToFossilPrimitive("TIMESTAMP")).toBe("DateTime");
    expect(duckdbTypeToFossilPrimitive("DATETIME")).toBe("DateTime");
    expect(duckdbTypeToFossilPrimitive("TIME")).toBe("Time");
  });

  it("falls back to String for VARCHAR + unknown types, case/space-insensitive", () => {
    expect(duckdbTypeToFossilPrimitive("VARCHAR")).toBe("String");
    expect(duckdbTypeToFossilPrimitive("  text ")).toBe("String");
    expect(duckdbTypeToFossilPrimitive("STRUCT(a INT)")).toBe("String");
  });
});

describe("extractSourceRefs", () => {
  it("scrapes csv + json source bindings with the @conn/path form", () => {
    const text = [
      'users := io.csv("@warehouse/users.csv")',
      "orders := io.json('@warehouse/orders.json')",
    ].join("\n");
    expect(extractSourceRefs(text)).toEqual([
      { sourceName: "users", url: "@warehouse/users.csv" },
      { sourceName: "orders", url: "@warehouse/orders.json" },
    ]);
  });

  it("ignores non-source lines and tolerates surrounding whitespace", () => {
    const text = "  people  :=  io.csv( \"data.csv\" )\nx := 1 + 2\n";
    expect(extractSourceRefs(text)).toEqual([
      { sourceName: "people", url: "data.csv" },
    ]);
  });

  it("returns empty for text with no source bindings", () => {
    expect(extractSourceRefs("prefix ex: <https://example.org/>")).toEqual([]);
  });
});

describe("buildInferredDescriptor", () => {
  it("maps DESCRIBE rows to a typed descriptor with empty content_hash", () => {
    const rows = [
      { column_name: "id", column_type: "INTEGER" },
      { column_name: "name", column_type: "VARCHAR" },
      { column_name: "joined", column_type: "TIMESTAMP" },
    ];
    expect(buildInferredDescriptor("users", rows)).toEqual({
      source_name: "users",
      columns: [
        { name: "id", primitive: "Integer" },
        { name: "name", primitive: "String" },
        { name: "joined", primitive: "DateTime" },
      ],
      content_hash: "",
    });
  });

  it("drops columns with empty/missing names", () => {
    const rows = [
      { column_name: "ok", column_type: "INT" },
      { column_name: "", column_type: "INT" },
      { column_type: "INT" },
    ];
    const d = buildInferredDescriptor("s", rows);
    expect(d.columns).toEqual([{ name: "ok", primitive: "Integer" }]);
  });
});
