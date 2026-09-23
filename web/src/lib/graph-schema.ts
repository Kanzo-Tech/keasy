import type { FieldRole, FieldStat, SchemaResult } from "@fossil-lang/corpus";

// ── Types ────────────────────────────────────────────────────────────────

// FieldRole is owned by fossil (the `schema` verb is the single source for role
// inference — keasy no longer infers roles client-side).
export type { FieldRole };
export type YAgg = "count" | "sum" | "avg" | "min" | "max";
export type MarkType = "barY" | "lineY" | "dot" | "rectY" | "cell";

export interface FieldInfo {
  /** Unique key: "person::age" */
  key: string;
  /** Column name in DuckDB: "age" */
  name: string;
  /** GraphAr datatype spelling: "int64", "double", … Empty until the stats land. */
  type: string;
  role: FieldRole;
  /** Vertex type this field belongs to */
  sourceType: string;
  /** Cardinality from the schema verb (absent until computed). */
  distinct?: number;
  count?: number;
}

export interface VertexType {
  name: string;
  entityCount: number;
  fields: FieldInfo[];
}

export interface EdgeType {
  sourceType: string;
  name: string;
  targetType: string;
  count: number;
  /** The relation the corpus registered: "person_works_at_org" */
  tableName: string;
}

export interface SourceQuery {
  /** DuckDB relation to query — registered by the corpus, not by keasy */
  tableName: string;
}

export interface GraphSchema {
  types: VertexType[];
  edges: EdgeType[];
  allFields: FieldInfo[];

  /** Lookup field by key ("person::age") */
  field(key: string): FieldInfo | undefined;

  /** Fields for a specific vertex type */
  fieldsOf(typeName: string): FieldInfo[];

  /** Build SQL source for a set of fields (auto-joins if cross-type) */
  buildSource(fields: FieldInfo[]): SourceQuery;
}

// ── Type checks (GraphAr datatype spellings) ─────────────────────────────
//
// `datatype` carries GraphAr spelling (`int64`, `double`, `date`, …), NOT
// DuckDB names. These classify it for vgplot chart binning (the reactive
// Mosaic layer). Role inference is NOT here — it's the `schema` verb's job.

const NUMERIC_GRAPHAR_TYPES = new Set([
  "int8", "int16", "int32", "int64",
  "uint8", "uint16", "uint32", "uint64",
  "float", "double",
]);

const TEMPORAL_GRAPHAR_TYPES = new Set(["date", "timestamp", "time"]);

export function isNumericType(datatype: string): boolean {
  return NUMERIC_GRAPHAR_TYPES.has(datatype.toLowerCase());
}

export function isTemporalType(datatype: string): boolean {
  return TEMPORAL_GRAPHAR_TYPES.has(datatype.toLowerCase());
}

/** A field whose chart axis can be binned: numeric or temporal. */
export function isBinnable(datatype: string): boolean {
  return isNumericType(datatype) || isTemporalType(datatype);
}

// ── Field key ───────────────────────────────────────────────────────────

export function fieldKey(sourceType: string, name: string): string {
  return `${sourceType}::${name}`;
}

/** Per-vertex-type field stats, from one `schema({ vertex_type })` call each. */
export type FieldStatsMap = Map<string, FieldStat[]>;

// ── Build schema from the schema verb ───────────────────────────────────

/**
 * Build the graph schema from what the `schema` verb answered. Pass `stats`
 * (one `schema({ vertex_type })` per type) to attach datatype, role and
 * cardinality; without them a field is a name, its role defaults to
 * "dimension" and nothing is binnable until the stats land.
 */
export function buildGraphSchema(overview: SchemaResult, stats?: FieldStatsMap): GraphSchema {
  const types: VertexType[] = overview.vertices.map((v) => {
    const measured = stats?.get(v.name);
    const fields: FieldInfo[] = measured
      ? measured.map((f) => ({
          key: fieldKey(v.name, f.name),
          name: f.name,
          type: f.datatype,
          role: f.role,
          sourceType: v.name,
          distinct: f.distinct,
          count: v.count,
        }))
      : v.fields.map((name) => ({
          key: fieldKey(v.name, name),
          name,
          type: "",
          role: "dimension" as FieldRole,
          sourceType: v.name,
        }));
    return { name: v.name, entityCount: v.count, fields };
  });

  const edges: EdgeType[] = overview.edges.map((e) => ({
    sourceType: e.source_type,
    name: e.name,
    targetType: e.target_type,
    count: e.count,
    tableName: e.table_name,
  }));

  const allFields = types.flatMap((t) => t.fields);
  const keyMap = new Map(allFields.map((f) => [f.key, f]));

  function field(key: string): FieldInfo | undefined {
    return keyMap.get(key);
  }

  function fieldsOf(typeName: string): FieldInfo[] {
    return types.find((t) => t.name === typeName)?.fields ?? [];
  }

  function edgeBetween(typeA: string, typeB: string): EdgeType | undefined {
    return edges.find((e) =>
      (e.sourceType === typeA && e.targetType === typeB) ||
      (e.sourceType === typeB && e.targetType === typeA),
    );
  }

  function buildSource(fields: FieldInfo[]): SourceQuery {
    const sourceTypes = [...new Set(fields.map((f) => f.sourceType))];

    if (sourceTypes.length <= 1) {
      return { tableName: sourceTypes[0] ?? overview.vertices[0]?.name ?? "data" };
    }

    if (sourceTypes.length === 2) {
      const [typeA, typeB] = sourceTypes;
      const edge = edgeBetween(typeA, typeB);
      if (!edge) return { tableName: typeA };

      // Inline JOIN subquery over the relations the corpus registered, on the
      // writer's own addressing columns.
      const tableName =
        `(SELECT s.*, t.* FROM "${edge.sourceType}" s ` +
        `JOIN "${edge.tableName}" e ON s.dense_id = e.src_dense ` +
        `JOIN "${edge.targetType}" t ON t.dense_id = e.dst_dense)`;
      return { tableName };
    }

    return { tableName: sourceTypes[0] };
  }

  return { types, edges, allFields, field, fieldsOf, buildSource };
}

// ── SQL description (for the LLM) ───────────────────────────────────────

/** GraphAr datatype spelling → the DuckDB type a filter should expect. */
function duckTypeOf(datatype: string): string {
  if (isTemporalType(datatype)) return datatype.toUpperCase();
  if (datatype === "int64" || datatype === "int32") return "BIGINT";
  if (datatype === "double" || datatype === "float") return "DOUBLE";
  if (datatype === "bool" || datatype === "boolean") return "BOOLEAN";
  return "VARCHAR";
}

/**
 * The corpus as DDL, for a prompt.
 *
 * The server used to write this from the run report, which made it the host's
 * own spelling of fossil's naming — the edge table composed in Rust, the columns
 * invented. It is written here instead, against the relations the corpus
 * actually registered in this browser's DuckDB: every name comes from the
 * `schema` verb, and the addressing columns are the ones `buildSource` joins on.
 */
export function sqlSchemaOf(schema: GraphSchema): string {
  const lines: string[] = [];
  for (const type of schema.types) {
    const columns = [
      '  "dense_id" UBIGINT',
      '  "subject" VARCHAR',
      ...type.fields.map((f) => `  "${f.name}" ${duckTypeOf(f.type)}`),
    ];
    lines.push(
      `CREATE TABLE "${type.name}" (\n${columns.join(",\n")}\n); -- rows: ${type.entityCount}\n`,
    );
  }
  for (const edge of schema.edges) {
    lines.push(
      `CREATE TABLE "${edge.tableName}" (\n  "src_dense" UBIGINT,\n  "dst_dense" UBIGINT\n);` +
        ` -- ${edge.sourceType} --[${edge.name}]--> ${edge.targetType} (${edge.count} edges)\n`,
    );
  }
  return lines.join("\n");
}
