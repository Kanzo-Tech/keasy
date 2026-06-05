import { describe, it, expect } from "vitest";
import {
  isNumericType,
  isTemporalType,
  isBinnable,
  fieldKey,
  buildGraphSchema,
  foldVertexStats,
  type FieldStatsMap,
} from "@/lib/graph-schema";
import type { RunStatus } from "@/lib/types";

// ── Test fixtures (GraphAr datatype spellings — what RunStatus carries) ───

const manifest: RunStatus = {
  dest: "",
  vertices: [
    {
      type: "person",
      file: "person.parquet",
      count: 100,
      columns: [
        { name: "subject", data_type: "string" },
        { name: "age", data_type: "int64" },
        { name: "dept", data_type: "string" },
      ],
    },
    {
      type: "org",
      file: "org.parquet",
      count: 20,
      columns: [
        { name: "subject", data_type: "string" },
        { name: "revenue", data_type: "int64" },
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

  it("without verb stats, roles default to dimension (fossil is the source)", () => {
    expect(schema.field("person::dept")?.role).toBe("dimension");
    expect(schema.field("person::age")?.role).toBe("dimension");
    expect(schema.field("person::dept")?.distinct).toBeUndefined();
  });

  it("attaches authoritative role + cardinality from describe_vertex_type", () => {
    const stats: FieldStatsMap = new Map();
    foldVertexStats(stats, "person", 100, [
      { name: "age", datatype: "int64", distinct: 80, role: "measure" },
      { name: "dept", datatype: "string", distinct: 95, role: "identifier" },
    ]);
    const enriched = buildGraphSchema(manifest, stats);
    expect(enriched.field("person::age")?.role).toBe("measure");
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
        { type: "a", file: "", count: 0, columns: [{ name: "x", data_type: "string" }] },
        { type: "b", file: "", count: 0, columns: [{ name: "y", data_type: "string" }] },
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
