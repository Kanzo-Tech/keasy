import type { Coordinator } from "@uwdata/mosaic-core";

import type { DataManifest, RunStatus } from "@/lib/types";

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

export function edgeTableName(sourceType: string, name: string, targetType: string): string {
  return `${sourceType}_${name}_${targetType}`;
}

// ── Browser-side column statistics ───────────────────────────────────────

/** Per-field cardinality, keyed by `FieldInfo.key`. */
export type ColumnStatsMap = Map<string, { distinct: number; count: number }>;

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Profile each vertex view in DuckDB-WASM: row count + per-column distinct
 * count, in one query per type. RunStatus carries no statistics (host-boundary:
 * the server ships structure, the browser owns stats) — this is where the
 * browser fills that in.
 */
export async function computeColumnStats(
  coordinator: Coordinator,
  schema: GraphSchema,
): Promise<ColumnStatsMap> {
  const out: ColumnStatsMap = new Map();
  await Promise.all(
    schema.types.map(async (t) => {
      if (t.fields.length === 0) return;
      const selects = [
        "COUNT(*) AS n",
        ...t.fields.map((f, i) => `COUNT(DISTINCT ${quoteIdent(f.name)}) AS d${i}`),
      ];
      const sql = `SELECT ${selects.join(", ")} FROM ${quoteIdent(t.name)}`;
      const rows = (await coordinator.query(sql, { type: "json" })) as
        | Array<Record<string, number>>
        | undefined;
      const row = rows?.[0];
      if (!row) return;
      const count = Number(row.n ?? 0);
      t.fields.forEach((f, i) => {
        out.set(f.key, { count, distinct: Number(row[`d${i}`] ?? 0) });
      });
    }),
  );
  return out;
}

// ── Build schema from manifest ──────────────────────────────────────────

/**
 * Build the graph schema from the subprocess `RunStatus`. Pass `stats` (from
 * [`computeColumnStats`]) to refine role inference with browser-computed
 * cardinality; without it, roles fall back to name + type heuristics.
 */
export function buildGraphSchema(manifest: RunStatus, stats?: ColumnStatsMap): GraphSchema {
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
        role: inferRole(c.name, c.data_type, s?.distinct, s?.count),
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

// ── Catalog adapter ──────────────────────────────────────────────────────

/**
 * Adapt the RDF-rich DCAT-AP `DataManifest` (Job.catalog_manifest) to a
 * `RunStatus` so the graph code consumes one shape. Lossy by design: RDF IRIs
 * and baked-in stats are dropped — the browser recomputes stats, and the graph
 * UI never read the IRIs.
 */
export function runStatusFromDataManifest(manifest: DataManifest): RunStatus {
  return {
    dest: "",
    vertices: manifest.types.map((t) => ({
      type: t.name,
      file: t.vertex_file,
      count: t.entity_count,
      columns: t.columns.map((c) => ({ name: c.name, data_type: c.datatype })),
    })),
    edges: (manifest.edges ?? []).map((e) => ({
      edge_type: e.name,
      src_type: e.source_type,
      dst_type: e.target_type,
      by_source: e.by_source,
      by_target: e.by_target,
      count: e.count,
    })),
  };
}
