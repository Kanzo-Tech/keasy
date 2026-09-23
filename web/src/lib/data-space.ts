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
