/**
 * Data Space mounting — GraphAr Parquets as DuckDB lazy views.
 *
 * Pattern: DuckDB lakehouse — CREATE VIEW over read_parquet(url).
 * The participant never downloads the promotor's data —
 * only the columns/rows needed for each query are transferred via HTTP Range requests.
 */

import type { RunStatus } from "@/lib/types";
import { edgeTableName } from "@/lib/graph-schema";
import type { MosaicInstance } from "@/lib/mosaic";

export async function mountDataSpace(
  conn: MosaicInstance["conn"],
  manifest: RunStatus,
  signedUrls: Record<string, string>,
): Promise<void> {
  await conn.query("SET enable_http_metadata_cache = true");

  const stmts: string[] = [];

  for (const v of manifest.vertices) {
    const url = signedUrls[v.file] ?? v.file;
    stmts.push(`CREATE OR REPLACE VIEW "${v.type}" AS SELECT * FROM read_parquet('${escapeUrl(url)}')`);
  }
  for (const e of manifest.edges ?? []) {
    const name = edgeTableName(e.src_type, e.edge_type, e.dst_type);
    const url = signedUrls[e.by_source] ?? e.by_source;
    stmts.push(`CREATE OR REPLACE VIEW "${name}" AS SELECT * FROM read_parquet('${escapeUrl(url)}')`);
  }

  // DDL statements are independent — execute in parallel
  await Promise.all(stmts.map((s) => conn.query(s)));
}

function escapeUrl(url: string): string {
  return url.replace(/'/g, "''");
}
