import type { FieldRole, FieldStat, SchemaResult } from "@fossil-lang/corpus";

export interface FieldInfo {
  /** Column name in DuckDB: "age" */
  name: string;
  /** GraphAr datatype spelling: "int64", "double", … Empty until the stats land. */
  type: string;
  /** Owned by fossil: the `schema` verb is the single source for role inference. */
  role: FieldRole;
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

export interface GraphSchema {
  types: VertexType[];
  edges: EdgeType[];
  fieldsOf(typeName: string): FieldInfo[];
}

// `datatype` carries GraphAr spelling (`int64`, `double`, `date`, …), not DuckDB names.

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

/** Per-vertex-type field stats, from one `schema({ vertex_type })` call each. */
export type FieldStatsMap = Map<string, FieldStat[]>;

/**
 * Build the graph schema from what the `schema` verb answered. Pass `stats`
 * (one `schema({ vertex_type })` per type) to attach datatype and role;
 * without them a field is a name, its role defaults to "dimension" and nothing
 * is binnable until the stats land.
 */
export function buildGraphSchema(overview: SchemaResult, stats?: FieldStatsMap): GraphSchema {
  const types: VertexType[] = overview.vertices.map((v) => {
    const measured = stats?.get(v.name);
    const fields: FieldInfo[] = measured
      ? measured.map((f) => ({ name: f.name, type: f.datatype, role: f.role }))
      : v.fields.map((name) => ({ name, type: "", role: "dimension" }));
    return { name: v.name, entityCount: v.count, fields };
  });

  const edges: EdgeType[] = overview.edges.map((e) => ({
    sourceType: e.source_type,
    name: e.name,
    targetType: e.target_type,
    count: e.count,
    tableName: e.table_name,
  }));

  return {
    types,
    edges,
    fieldsOf: (typeName) => types.find((t) => t.name === typeName)?.fields ?? [],
  };
}
