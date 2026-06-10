import type { RunStatus } from "@/lib/types";
import type { FieldRole, FieldStat } from "@fossil-lang/graph";

// ── Types ────────────────────────────────────────────────────────────────

// FieldRole is owned by fossil-graph (the `describe_vertex_type` verb is the
// single source for role inference — keasy no longer infers roles client-side).
export type { FieldRole };
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
  /** Cardinality from browser-side DuckDB-WASM profiling (absent until computed). */
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

// ── Type checks (GraphAr datatype spellings) ─────────────────────────────
//
// `data_type` carries GraphAr spelling (`int64`, `double`, `date`, …), NOT
// DuckDB names. These classify it for vgplot chart binning (the reactive
// Mosaic layer). Role inference is NOT here — it's the `describe_vertex_type`
// verb's job (fossil is the single source).

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

export function edgeTableName(sourceType: string, name: string, targetType: string): string {
  return `${sourceType}_${name}_${targetType}`;
}

// ── Verb-sourced field stats ─────────────────────────────────────────────

/**
 * Per-field role + cardinality, keyed by `FieldInfo.key`. Built from the
 * `describe_vertex_type` verb — the single source. keasy no longer profiles
 * columns or infers roles client-side ([[feedback_one_idiom_per_concern]]).
 */
export type FieldStatsMap = Map<
  string,
  { role: FieldRole; distinct: number; count: number }
>;

/** Fold one vertex type's `describe_vertex_type` result into the stats map. */
export function foldVertexStats(
  stats: FieldStatsMap,
  typeName: string,
  count: number,
  fields: FieldStat[],
): void {
  for (const f of fields) {
    stats.set(fieldKey(typeName, f.name), {
      role: f.role,
      distinct: f.distinct,
      count,
    });
  }
}

// ── Build schema from manifest ──────────────────────────────────────────

/**
 * Build the graph schema from the subprocess `RunStatus`. Pass `stats` (folded
 * from the `describe_vertex_type` verb) to attach authoritative role +
 * cardinality; without it (phase 1) roles default to "dimension" until the verb
 * result lands.
 */
export function buildGraphSchema(manifest: RunStatus, stats?: FieldStatsMap): GraphSchema {
  const types: VertexType[] = manifest.vertices.map((v) => ({
    name: v.type,
    entityCount: v.count ?? 0,
    fields: v.columns.map((c) => {
      const key = fieldKey(v.type, c.name);
      const s = stats?.get(key);
      return {
        key,
        name: c.name,
        type: c.data_type,
        // Role comes from the verb; before it lands (phase 1) default to
        // "dimension" so every field stays visible until refined.
        role: s?.role ?? "dimension",
        sourceType: v.type,
        distinct: s?.distinct,
        count: s?.count,
      };
    }),
  }));

  const edges: EdgeType[] = (manifest.edges ?? []).map((e) => ({
    sourceType: e.src_type,
    name: e.edge_type,
    targetType: e.dst_type,
    count: e.count ?? 0,
    tableName: edgeTableName(e.src_type, e.edge_type, e.dst_type),
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
      return { tableName: sourceTypes[0] ?? manifest.vertices[0]?.type ?? "data" };
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
