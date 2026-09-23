import { describe, it, expect } from "vitest";
import {
  isNumericType,
  isTemporalType,
  isBinnable,
  fieldKey,
  buildGraphSchema,
  type FieldStatsMap,
} from "@/lib/graph-schema";
import type { SchemaResult } from "@fossil-lang/corpus";

// ── Test fixtures — what the `schema` verb answers ───────────────────────

const overview: SchemaResult = {
  vertices: [
    { name: "person", iri: "https://example.org/Person", count: 100, fields: ["subject", "age", "dept"] },
    { name: "org", iri: "https://example.org/Org", count: 20, fields: ["subject", "revenue"] },
  ],
  edges: [
    {
      name: "works_at",
      iri: "https://example.org/works_at",
      source_type: "person",
      target_type: "org",
      count: 100,
      table_name: "person_works_at_org",
    },
  ],
  fields: [],
};

// ── Type checks (GraphAr spellings; chart-binning concern, not role) ──────

describe("type classification", () => {
  it("isNumericType recognizes GraphAr numeric spellings", () => {
    expect(isNumericType("int64")).toBe(true);
    expect(isNumericType("double")).toBe(true);
    expect(isNumericType("uint32")).toBe(true);
    expect(isNumericType("string")).toBe(false);
  });
  it("isTemporalType recognizes date/timestamp", () => {
    expect(isTemporalType("date")).toBe(true);
    expect(isTemporalType("timestamp")).toBe(true);
    expect(isTemporalType("string")).toBe(false);
  });
  it("isBinnable is numeric or temporal", () => {
    expect(isBinnable("int64")).toBe(true);
    expect(isBinnable("date")).toBe(true);
    expect(isBinnable("string")).toBe(false);
  });
});

// ── GraphSchema ─────────────────────────────────────────────────────────

describe("buildGraphSchema", () => {
  const schema = buildGraphSchema(overview);

  it("creates vertex types from the schema verb", () => {
    expect(schema.types).toHaveLength(2);
    expect(schema.types[0].name).toBe("person");
    expect(schema.types[0].entityCount).toBe(100);
    expect(schema.types[1].name).toBe("org");
  });

  it("takes the edge relation name from the verb, it does not spell one", () => {
    expect(schema.edges).toHaveLength(1);
    expect(schema.edges[0].tableName).toBe("person_works_at_org");
  });

  it("field() resolves by key", () => {
    expect(schema.field("person::age")?.name).toBe("age");
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

  it("without stats, a field is a name and nothing is binnable", () => {
    expect(schema.field("person::dept")?.role).toBe("dimension");
    expect(schema.field("person::age")?.type).toBe("");
    expect(schema.field("person::dept")?.distinct).toBeUndefined();
  });

  it("attaches authoritative datatype, role and cardinality from the verb", () => {
    const stats: FieldStatsMap = new Map([
      [
        "person",
        [
          { name: "age", datatype: "int64", distinct: 80, role: "measure" as const, samples: [] },
          { name: "dept", datatype: "string", distinct: 95, role: "identifier" as const, samples: [] },
        ],
      ],
    ]);
    const enriched = buildGraphSchema(overview, stats);
    expect(enriched.field("person::age")?.role).toBe("measure");
    expect(enriched.field("person::age")?.type).toBe("int64");
    expect(enriched.field("person::dept")?.role).toBe("identifier");
    expect(enriched.field("person::dept")?.distinct).toBe(95);
  });
});

describe("buildSource", () => {
  const schema = buildGraphSchema(overview);

  it("single type → direct relation", () => {
    const age = schema.field("person::age")!;
    const dept = schema.field("person::dept")!;
    expect(schema.buildSource([age, dept]).tableName).toBe("person");
  });

  it("cross-type → inline JOIN on the writer's addressing columns", () => {
    const age = schema.field("person::age")!;
    const revenue = schema.field("org::revenue")!;
    const source = schema.buildSource([age, revenue]);
    expect(source.tableName).toContain("JOIN");
    expect(source.tableName).toContain("s.dense_id = e.src_dense");
    expect(source.tableName).toContain("t.dense_id = e.dst_dense");
  });

  it("no connection → fallback to first type", () => {
    const disconnected: SchemaResult = {
      vertices: [
        { name: "a", iri: "", count: 0, fields: ["x"] },
        { name: "b", iri: "", count: 0, fields: ["y"] },
      ],
      edges: [],
      fields: [],
    };
    const s = buildGraphSchema(disconnected);
    expect(s.buildSource([s.field("a::x")!, s.field("b::y")!]).tableName).toBe("a");
  });
});

// ── fieldKey ────────────────────────────────────────────────────────────

describe("fieldKey", () => {
  it("produces Type::field format", () => {
    expect(fieldKey("person", "age")).toBe("person::age");
  });
});
