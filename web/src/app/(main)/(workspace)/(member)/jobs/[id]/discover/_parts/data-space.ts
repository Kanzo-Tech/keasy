import { relation, type Catalog } from "@/lib/fossil/corpus";

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

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
 * The corpus is attached as its own catalog, named by the job's id, so that is where the columns
 * are read from — its two manifest relations, `fossil_tables` and `fossil_columns`, left out — and
 * every table is named as a query must write it, `"<jobId>"."<Table>"`: the agent's SQL runs as
 * written, unqualified names included.
 *
 * The one fact the catalog cannot carry is which vertex tables an edge table
 * joins: the views have no foreign keys. That comes from the corpus's `fossil_tables`
 * and rides along as a comment on the edge table: which column holds which
 * vertex table's key.
 */
export async function describeDataSpace(
  query: (sql: string) => Promise<unknown>,
  jobId: string,
  catalog: Catalog,
): Promise<string> {
  const rows = (await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_catalog = ${literal(jobId)} AND table_name NOT IN ('fossil_tables', 'fossil_columns')
      ORDER BY table_name, ordinal_position`,
  )) as ColumnRow[];

  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    const cols = byTable.get(r.table_name) ?? [];
    cols.push(`  "${r.column_name}" ${r.data_type}`);
    byTable.set(r.table_name, cols);
  }

  const keys = new Map(catalog.vertex_tables.map((t) => [t.name, t.key] as const));
  const end = (e: { key: string; references: string }) => {
    const key = keys.get(e.references);
    if (key === undefined) throw new Error(`An edge table references ${e.references}, which the corpus does not declare`);
    return `"${e.key}" -> ${relation(jobId, e.references)}."${key}"`;
  };
  const endpoints = new Map(
    catalog.edge_tables.map(
      (e) => [e.name, `${e.iri ?? e.name}: ${end(e.source)}, ${end(e.destination)}`] as const,
    ),
  );

  return [...byTable]
    .map(([table, cols]) => {
      const edge = endpoints.get(table);
      return `CREATE TABLE ${relation(jobId, table)} (\n${cols.join(",\n")}\n);${edge ? ` -- ${edge}` : ""}`;
    })
    .join("\n\n");
}
