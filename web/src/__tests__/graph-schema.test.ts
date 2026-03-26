import { describe, it, expect } from "vitest";
import {
  inferRole,
  isNumericType,
  fieldKey,
  buildGraphSchema,
} from "@/lib/graph-schema";
import type { DataManifest } from "@/lib/types";

// ── Test fixtures ───────────────────────────────────────────────────────

const manifest: DataManifest = {
  types: [
    {
      name: "person",
      iri: "urn:Person",
      vertex_file: "person.parquet",
      entity_count: 100,
      columns: [
        { name: "subject", iri: "urn:subject", datatype: "VARCHAR", count: 100, n_unique: 100, min: null, max: null },
        { name: "age", iri: "urn:age", datatype: "DOUBLE", count: 100, n_unique: 50, min: "18", max: "90" },
        { name: "dept", iri: "urn:dept", datatype: "VARCHAR", count: 100, n_unique: 5, min: null, max: null, samples: ["Engineering", "Sales"] },
      ],
    },
    {
      name: "org",
      iri: "urn:Org",
      vertex_file: "org.parquet",
      entity_count: 20,
      columns: [
        { name: "subject", iri: "urn:subject", datatype: "VARCHAR", count: 20, n_unique: 20, min: null, max: null },
        { name: "revenue", iri: "urn:revenue", datatype: "BIGINT", count: 20, n_unique: 18, min: "1000", max: "999999" },
      ],
    },
  ],
  edges: [
    { source_type: "person", name: "works_at", target_type: "org", count: 100, by_source: "e.parquet", by_target: "e_t.parquet", iri: "urn:works_at" },
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
    const noEdgeManifest: DataManifest = {
      types: [
        { name: "a", iri: "", vertex_file: "", entity_count: 0, columns: [
          { name: "x", iri: "", datatype: "VARCHAR", count: 0, n_unique: 0, min: null, max: null },
        ] },
        { name: "b", iri: "", vertex_file: "", entity_count: 0, columns: [
          { name: "y", iri: "", datatype: "VARCHAR", count: 0, n_unique: 0, min: null, max: null },
        ] },
      ],
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
