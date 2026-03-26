/**
 * Mosaic Coordinator initialization — direct, no wrappers.
 *
 * Uses wasmConnector from @uwdata/mosaic-core which lazily initializes
 * DuckDB WASM internally. We then access db/conn for data space mounting.
 *
 * All data queries (histograms, crossfilter, AI chat) flow through this Coordinator.
 */

import { Coordinator, coordinator as setGlobalCoordinator, wasmConnector, type DuckDBWASMConnector } from "@uwdata/mosaic-core";

export interface MosaicInstance {
  coordinator: Coordinator;
  connector: DuckDBWASMConnector;
  /** DuckDB instance (type from mosaic-core's internal duckdb-wasm) */
  db: Awaited<ReturnType<DuckDBWASMConnector["getDuckDB"]>>;
  /** DuckDB connection (type from mosaic-core's internal duckdb-wasm) */
  conn: Awaited<ReturnType<DuckDBWASMConnector["getConnection"]>>;
}

/**
 * Initialize the Mosaic Coordinator with a DuckDB WASM backend.
 * wasmConnector handles DuckDB WASM lifecycle (download, instantiate).
 * Returns coordinator + db/conn for data space mounting.
 *
 * Singleton: first call starts init, subsequent calls return the same Promise.
 * This avoids re-downloading the WASM binary on component re-mounts.
 */
let cachedPromise: Promise<MosaicInstance> | null = null;

export function initMosaic(): Promise<MosaicInstance> {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const connector = wasmConnector();
      const coord = new Coordinator(connector);
      setGlobalCoordinator(coord);
      const db = await connector.getDuckDB();
      const conn = await connector.getConnection();
      return { coordinator: coord, connector, db, conn };
    })();
  }
  return cachedPromise;
}
