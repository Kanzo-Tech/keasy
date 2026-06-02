import { describe, it, expect } from "vitest";
import {
  inferRole,
  isNumericType,
  fieldKey,
  buildGraphSchema,
  type ColumnStatsMap,
} from "@/lib/graph-schema";
import type { RunStatus } from "@/lib/types";

// ── Test fixtures ───────────────────────────────────────────────────────

const manifest: RunStatus = {
  dest: "",
  vertices: [
    {
      type: "person",
      file: "person.parquet",
      count: 100,
      columns: [
        { name: "subject", data_type: "VARCHAR" },
        { name: "age", data_type: "DOUBLE" },
        { name: "dept", data_type: "VARCHAR" },
      ],
    },
    {
      type: "org",
      file: "org.parquet",
      count: 20,
      columns: [
        { name: "subject", data_type: "VARCHAR" },
        { name: "revenue", data_type: "BIGINT" },
      ],
    },
  ],
  edges: [
    {
      edge_type: "works_at",
      src_type: "person",
      dst_type: "org",
      by_source: "e.parquet",
      by_target: "e_t.parquet",
      count: 100,
    },
  ],
};

// ── Type checks ─────────────────────────────────────────────────────────

describe("isNumericType", () => {
  it("recognizes numeric types", () => {
    expect(isNumericType("INTEGER")).toBe(true);
    expect(isNumericType("DECIMAL(10,2)")).toBe(true);
    expect(isNumericType("VARCHAR")).toBe(false);
  });
});

// ── Role inference ──────────────────────────────────────────────────────

describe("inferRole", () => {
  it("identifier by name pattern", () => {
    expect(inferRole("entity_id", "VARCHAR")).toBe("identifier");
  });
  it("measure for numeric types", () => {
    expect(inferRole("price", "DOUBLE")).toBe("measure");
  });
  it("dimension for boolean", () => {
    expect(inferRole("active", "BOOLEAN")).toBe("dimension");
  });
  it("dimension for temporal", () => {
    expect(inferRole("created_at", "DATE")).toBe("dimension");
  });
  it("identifier for high-cardinality VARCHAR", () => {
    expect(inferRole("name", "VARCHAR", 900, 1000)).toBe("identifier");
  });
  it("dimension for low-cardinality VARCHAR", () => {
    expect(inferRole("category", "VARCHAR", 5, 1000)).toBe("dimension");
  });
});

// ── GraphSchema ─────────────────────────────────────────────────────────

describe("buildGraphSchema", () => {
  const schema = buildGraphSchema(manifest);

  it("creates vertex types from manifest", () => {
    expect(schema.types).toHaveLength(2);
    expect(schema.types[0].name).toBe("person");
    expect(schema.types[0].entityCount).toBe(100);
    expect(schema.types[1].name).toBe("org");
  });

  it("creates edges from manifest", () => {
    expect(schema.edges).toHaveLength(1);
    expect(schema.edges[0].tableName).toBe("person_works_at_org");
  });

  it("field() resolves by key", () => {
    expect(schema.field("person::age")?.name).toBe("age");
    expect(schema.field("org::revenue")?.role).toBe("measure");
    expect(schema.field("nonexistent")).toBeUndefined();
  });

  it("fieldsOf() returns fields for a type", () => {
    expect(schema.fieldsOf("person")).toHaveLength(3);
    expect(schema.fieldsOf("unknown")).toHaveLength(0);
  });

  it("produces unique field keys across types", () => {
    const keys = schema.allFields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("without stats, infers role from name + type only", () => {
    expect(schema.field("person::dept")?.role).toBe("dimension");
    expect(schema.field("person::dept")?.distinct).toBeUndefined();
  });

  it("refines role with browser-computed cardinality", () => {
    const stats: ColumnStatsMap = new Map([
      ["person::dept", { distinct: 95, count: 100 }],
    ]);
    const enriched = buildGraphSchema(manifest, stats);
    expect(enriched.field("person::dept")?.role).toBe("identifier");
    expect(enriched.field("person::dept")?.distinct).toBe(95);
  });
});

describe("buildSource", () => {
  const schema = buildGraphSchema(manifest);

  it("single type → direct table", () => {
    const age = schema.field("person::age")!;
    const dept = schema.field("person::dept")!;
    const source = schema.buildSource([age, dept]);
    expect(source.tableName).toBe("person");
  });

  it("cross-type → inline JOIN subquery", () => {
    const age = schema.field("person::age")!;
    const revenue = schema.field("org::revenue")!;
    const source = schema.buildSource([age, revenue]);
    expect(source.tableName).toContain("JOIN");
    expect(source.tableName).toContain('"person"');
    expect(source.tableName).toContain('"org"');
  });

  it("no connection → fallback to first type", () => {
    const noEdgeManifest: RunStatus = {
      dest: "",
      vertices: [
        { type: "a", file: "", count: 0, columns: [{ name: "x", data_type: "VARCHAR" }] },
        { type: "b", file: "", count: 0, columns: [{ name: "y", data_type: "VARCHAR" }] },
      ],
      edges: [],
    };
    const s = buildGraphSchema(noEdgeManifest);
    const source = s.buildSource([s.field("a::x")!, s.field("b::y")!]);
    expect(source.tableName).toBe("a");
  });
});

// ── fieldKey ────────────────────────────────────────────────────────────

describe("fieldKey", () => {
  it("produces Type::field format", () => {
    expect(fieldKey("person", "age")).toBe("person::age");
  });
});
