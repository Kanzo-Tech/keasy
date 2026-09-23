/**
 * Lend the corpus reader keasy's access.
 *
 * fossil addresses a corpus by dataset-relative name (`vertex/Person/tiles.parquet`)
 * and composes every read itself; keasy's blobs sit behind per-file signatures, so
 * the name fossil composes is correct and unreadable. `@fossil-lang/corpus`'s
 * `readText` covers the manifests and nothing carries a credential for the payload.
 *
 * DuckDB's own file registry is where that gap closes without either side learning
 * the other's conventions: keasy registers the names it signed, fossil keeps naming
 * them, and `read_parquet('vertex/Person/tiles.parquet')` resolves to the signed URL.
 * A file fossil addresses and keasy never signed fails by name in DuckDB, which is
 * the diagnosis.
 */

import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";
import type { EdgeType } from "@/lib/graph-schema";
import type { MosaicInstance } from "@/lib/mosaic";

export async function registerDataSpace(
  db: MosaicInstance["db"],
  conn: MosaicInstance["conn"],
  signedUrls: Record<string, string>,
): Promise<void> {
  await conn.query("SET enable_http_metadata_cache = true");
  await Promise.all(
    Object.entries(signedUrls).map(([path, url]) =>
      db.registerFileURL(path, url, DuckDBDataProtocol.HTTP, false),
    ),
  );
}

// ── Describing what was mounted ──────────────────────────────────────────

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
