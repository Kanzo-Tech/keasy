import { TableRefNode } from "@uwdata/mosaic-sql";

const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

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
 * joins: the views have no foreign keys. That comes from the corpus's `fossil_tables` — an edge's
 * `source` and `destination` — and its `fossil_columns`, whose `endpoint` columns are the source's
 * and then the destination's, and rides along as a comment on the edge table: which column holds
 * which vertex table's `address`.
 */
export async function describeDataSpace(query: (sql: string) => Promise<unknown>, jobId: string): Promise<string> {
  const name = (table: string) => String(new TableRefNode([jobId, table]));
  const [columns, ends] = (await Promise.all([
    query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_catalog = ${literal(jobId)} AND table_name NOT IN ('fossil_tables', 'fossil_columns')
        ORDER BY table_name, ordinal_position`,
    ),
    query(
      `WITH ends AS (
         SELECT e.table_name, coalesce(e.iri, e.table_name) AS label, c.column_name, c.ordinal,
                CASE WHEN row_number() OVER (PARTITION BY e.table_name ORDER BY c.ordinal) = 1
                     THEN e.source ELSE e.destination END AS vertex
           FROM ${name("fossil_tables")} e
           JOIN ${name("fossil_columns")} c ON c.table_name = e.table_name AND c.role = 'endpoint'
          WHERE e.kind = 'edge')
       SELECT ends.table_name, ends.label, ends.column_name, ends.vertex, a.column_name AS address
         FROM ends LEFT JOIN ${name("fossil_columns")} a ON a.role = 'address' AND a.table_name = ends.vertex
        ORDER BY ends.table_name, ends.ordinal`,
    ),
  ])) as [
    { table_name: string; column_name: string; data_type: string }[],
    { table_name: string; label: string; column_name: string; vertex: string; address: string | null }[],
  ];

  const byTable = new Map<string, string[]>();
  for (const r of columns) {
    const cols = byTable.get(r.table_name) ?? [];
    cols.push(`  "${r.column_name}" ${r.data_type}`);
    byTable.set(r.table_name, cols);
  }

  const endpoints = new Map<string, string>();
  for (const e of ends) {
    if (e.address === null) throw new Error(`An edge table references ${e.vertex}, which the corpus does not declare`);
    const end = `"${e.column_name}" -> ${name(e.vertex)}."${e.address}"`;
    const before = endpoints.get(e.table_name);
    endpoints.set(e.table_name, before ? `${before}, ${end}` : `${e.label}: ${end}`);
  }

  return [...byTable]
    .map(([table, cols]) => {
      const edge = endpoints.get(table);
      return `CREATE TABLE ${name(table)} (\n${cols.join(",\n")}\n);${edge ? ` -- ${edge}` : ""}`;
    })
    .join("\n\n");
}
