import type { EdgeType } from "@/lib/graph-schema";

interface ColumnRow {
  table_name: string;
  column_name: string;
  data_type: string;
}

/**
 * The mounted data space as DuckDB DDL, read back from DuckDB's own catalog.
 *
 * This is the schema the SQL assistant is given. It is read from
 * `information_schema` rather than re-derived from the manifest so that the
 * table names, the column names and the column TYPES are the ones a query will
 * actually meet — the server has no business reconstructing them.
 *
 * The one fact the catalog cannot carry is which vertex tables an edge table
 * joins: the views have no foreign keys. That comes from the graph schema,
 * which fossil produced, and rides along as a comment on the edge table.
 */
export async function describeDataSpace(
  query: (sql: string) => Promise<unknown>,
  edges: EdgeType[],
): Promise<string> {
  const rows = (await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position`,
  )) as ColumnRow[];

  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    const cols = byTable.get(r.table_name) ?? [];
    cols.push(`  "${r.column_name}" ${r.data_type}`);
    byTable.set(r.table_name, cols);
  }

  const endpoints = new Map(
    edges.map((e) => [e.tableName, `${e.sourceType} --[${e.name}]--> ${e.targetType}`] as const),
  );

  return [...byTable]
    .map(([table, cols]) => {
      const edge = endpoints.get(table);
      return `CREATE TABLE "${table}" (\n${cols.join(",\n")}\n);${edge ? ` -- ${edge}` : ""}`;
    })
    .join("\n\n");
}
