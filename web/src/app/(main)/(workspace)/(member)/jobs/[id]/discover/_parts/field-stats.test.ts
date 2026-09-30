import { describe, expect, it } from "vitest";
import type { VertexTable } from "@fossil-lang/corpus";
import { kindOf, roleOf, summarize } from "./field-stats";

const PERSON: VertexTable = {
  name: "Person",
  path: "vertex/Person.parquet",
  key: "dense_id",
  identity: "subject",
  record_count: 1000,
  properties: [],
  position: { by: "layout", x: "x", y: "y" },
};

describe("field-stats", () => {
  it("reads DuckDB's type words as a kind", () => {
    expect(kindOf("BIGINT")).toBe("numeric");
    expect(kindOf("UINTEGER")).toBe("numeric");
    expect(kindOf("DECIMAL(10,2)")).toBe("numeric");
    expect(kindOf("TIMESTAMP WITH TIME ZONE")).toBe("temporal");
    expect(kindOf("DATE")).toBe("temporal");
    expect(kindOf("VARCHAR")).toBe("categorical");
  });

  it("calls a few-valued string a dimension and a unique one an identifier", () => {
    expect(roleOf("country", "categorical", 12, 1000)).toBe("dimension");
    expect(roleOf("email", "categorical", 998, 1000)).toBe("identifier");
    expect(roleOf("user_id", "numeric", 1000, 1000)).toBe("identifier");
    expect(roleOf("age", "numeric", 80, 1000)).toBe("measure");
  });

  it("leaves the key, the identity and the layout's coordinates out, and reads a bigint count", () => {
    const stats = summarize(PERSON, {
      columns: ["column_name", "column_type", "approx_unique"],
      rows: [
        ["dense_id", "UINTEGER", BigInt(1000)],
        ["subject", "VARCHAR", BigInt(1000)],
        ["x", "FLOAT", BigInt(990)],
        ["y", "FLOAT", BigInt(990)],
        ["country", "VARCHAR", BigInt(12)],
      ],
      truncated: false,
    });
    expect(stats).toEqual({
      name: "Person",
      count: 1000,
      fields: [{ name: "country", type: "VARCHAR", kind: "categorical", role: "dimension", distinct: 12 }],
    });
  });
});
