import type { DataManifest } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────

export type FieldRole = "measure" | "dimension" | "identifier";
export type YAgg = "count" | "sum" | "avg" | "min" | "max";
export type MarkType = "barY" | "lineY" | "dot" | "rectY" | "cell";

export interface FieldInfo {
  /** Unique key: "person::age" */
  key: string;
  /** Column name in DuckDB: "age" */
  name: string;
  /** DuckDB type: "VARCHAR", "DOUBLE", etc. */
  type: string;
  role: FieldRole;
  /** Vertex type this field belongs to */
  sourceType: string;
  iri: string;
  distinct?: number;
  count?: number;
  samples?: string[];
}

export interface VertexType {
  name: string;
  iri: string;
  entityCount: number;
  fields: FieldInfo[];
}

export interface EdgeType {
  sourceType: string;
  name: string;
  targetType: string;
  count: number;
  /** DuckDB view name: "person_works_at_org" */
  tableName: string;
}

export interface SourceQuery {
  /** DuckDB table/view name to query (pre-created at setup) */
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

// ── Type constants ──────────────────────────────────────────────────────

export const NUMERIC_DUCKDB_TYPES = new Set([
  "INTEGER", "BIGINT", "HUGEINT", "SMALLINT", "TINYINT",
  "DOUBLE", "FLOAT", "DECIMAL",
]);

export const TEMPORAL_DUCKDB_TYPES = new Set([
  "DATE", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE",
]);

// ── Type checks ─────────────────────────────────────────────────────────

export function isNumericType(datatype: string): boolean {
  const upper = datatype.toUpperCase();
  return NUMERIC_DUCKDB_TYPES.has(upper) || upper.startsWith("DECIMAL(");
}

// ── Role inference ──────────────────────────────────────────────────────

const IDENTIFIER_PATTERN = /(?:^|[_.])(id|uri|iri)(?:$|[_.])/i;

export function inferRole(
  name: string,
  type: string,
  nUnique?: number,
  count?: number,
): FieldRole {
  if (IDENTIFIER_PATTERN.test(name)) return "identifier";
  if (isNumericType(type)) return "measure";
  const upper = type.toUpperCase();
  if (upper === "BOOLEAN") return "dimension";
  if (TEMPORAL_DUCKDB_TYPES.has(upper)) return "dimension";
  if (nUnique != null && count != null && count > 0) {
    if (nUnique > 200 || nUnique / count > 0.8) return "identifier";
  }
  return "dimension";
}

// ── Field key ───────────────────────────────────────────────────────────

export function fieldKey(sourceType: string, name: string): string {
  return `${sourceType}::${name}`;
}

export function edgeTableName(edge: { source_type: string; name: string; target_type: string }): string {
  return `${edge.source_type}_${edge.name}_${edge.target_type}`;
}

// ── Build schema from manifest ──────────────────────────────────────────

export function buildGraphSchema(manifest: DataManifest): GraphSchema {
  const types: VertexType[] = manifest.types.map((t) => ({
    name: t.name,
    iri: t.iri,
    entityCount: t.entity_count,
    fields: t.columns.map((c) => ({
      key: fieldKey(t.name, c.name),
      name: c.name,
      type: c.datatype,
      role: inferRole(c.name, c.datatype, c.n_unique, c.count),
      sourceType: t.name,
      iri: c.iri,
      distinct: c.n_unique,
      count: c.count,
      samples: c.samples ?? [],
    })),
  }));

  const edges: EdgeType[] = (manifest.edges ?? []).map((e) => ({
    sourceType: e.source_type,
    name: e.name,
    targetType: e.target_type,
    count: e.count,
    tableName: edgeTableName(e),
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
      return { tableName: sourceTypes[0] ?? manifest.types[0]?.name ?? "data" };
    }

    if (sourceTypes.length === 2) {
      const [typeA, typeB] = sourceTypes;
      const edge = edgeBetween(typeA, typeB);
      if (!edge) return { tableName: typeA };

      // Inline JOIN subquery (no pre-created views needed — DuckDB views are lazy anyway)
      const edgeTable = edge.tableName;
      const tableName =
        `(SELECT s.*, t.* FROM "${edge.sourceType}" s ` +
        `JOIN "${edgeTable}" e ON s._id = e.source ` +
        `JOIN "${edge.targetType}" t ON t._id = e.target)`;
      return { tableName };
    }

    return { tableName: sourceTypes[0] };
  }

  return { types, edges, allFields, field, fieldsOf, buildSource };
}
