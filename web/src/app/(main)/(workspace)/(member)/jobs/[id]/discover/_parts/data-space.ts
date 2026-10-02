import type { Corpus, Manifest } from "@fossil-lang/corpus";

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
 * The views live in the corpus's own catalog and schema (`corpus.url`,
 * `corpus.schema`), so that is where the columns are read from, and every table
 * is named as a query must write it, `corpus.relation` — `executeSql` runs the SQL it is given, unqualified names included.
 *
 * The one fact the catalog cannot carry is which vertex tables an edge table
 * joins: the views have no foreign keys. That comes from the corpus's manifest
 * and rides along as a comment on the edge table: which column holds which
 * vertex table's key.
 */
export async function describeDataSpace(
  query: (sql: string) => Promise<unknown>,
  corpus: Pick<Corpus, "url" | "schema" | "relation">,
  manifest: Manifest,
): Promise<string> {
  const rows = (await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_catalog = ${literal(corpus.url)} AND table_schema = ${literal(corpus.schema)}
      ORDER BY table_name, ordinal_position`,
  )) as ColumnRow[];

  const byTable = new Map<string, string[]>();
  for (const r of rows) {
    const cols = byTable.get(r.table_name) ?? [];
    cols.push(`  "${r.column_name}" ${r.data_type}`);
    byTable.set(r.table_name, cols);
  }

  const keys = new Map(manifest.vertex_tables.map((t) => [t.name, t.key] as const));
  const end = (e: { key: string; references: string }) => {
    const key = keys.get(e.references);
    if (key === undefined) throw new Error(`An edge table references ${e.references}, which the corpus does not declare`);
    return `"${e.key}" -> ${corpus.relation(e.references)}."${key}"`;
  };
  const endpoints = new Map(
    manifest.edge_tables.map(
      (e) => [e.name, `${e.label}: ${end(e.source)}, ${end(e.destination)}`] as const,
    ),
  );

  return [...byTable]
    .map(([table, cols]) => {
      const edge = endpoints.get(table);
      return `CREATE TABLE ${corpus.relation(table)} (\n${cols.join(",\n")}\n);${edge ? ` -- ${edge}` : ""}`;
    })
    .join("\n\n");
}
