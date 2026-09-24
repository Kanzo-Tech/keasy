import { describe, it, expect } from "vitest";
import {
  isNumericType,
  isTemporalType,
  isBinnable,
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

  it("fieldsOf() returns fields for a type", () => {
    expect(schema.fieldsOf("person")).toHaveLength(3);
    expect(schema.fieldsOf("unknown")).toHaveLength(0);
  });

  it("without stats, a field is a name and nothing is binnable", () => {
    const [, age, dept] = schema.fieldsOf("person");
    expect(dept.role).toBe("dimension");
    expect(age.type).toBe("");
  });

  it("attaches authoritative datatype and role from the verb", () => {
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
    const [age, dept] = enriched.fieldsOf("person");
    expect(age.role).toBe("measure");
    expect(age.type).toBe("int64");
    expect(dept.role).toBe("identifier");
  });
});
