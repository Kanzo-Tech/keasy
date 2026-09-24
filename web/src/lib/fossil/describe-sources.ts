/**
 * Describe the sources a program binds, in the browser.
 *
 * `@fossil-lang/introspect` owns the logic — which bindings are sources, the
 * DESCRIBE each reader needs, the DuckDB→fossil type table. keasy lends it the
 * data plane: an `@conn/path` is signed against its connection and registered
 * with DuckDB-WASM under the URI the program wrote, and DuckDB reads it straight
 * from the store. The server never reads the file.
 */

import { introspect, type InferredDescriptor } from "@fossil-lang/introspect";

import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";

import { api } from "@/lib/api";
import { bootDuckDB } from "@/lib/fossil/open-job-corpus";
import type { Connection } from "@/lib/types";

/** `@connName/path` → its parts, or null for any other spelling. */
export function parseConnRef(uri: string): { connName: string; path: string } | null {
  const m = /^@([^/]+)\/(.+)$/.exec(uri);
  return m ? { connName: m[1], path: m[2] } : null;
}

/**
 * A file listed in a connection (its key in the bucket) as the path a program
 * writes after `@conn/`: relative to the connection's own prefix.
 */
export function connectionPath(connection: Connection, key: string): string {
  const prefix = new URL(connection.url).pathname.replace(/^\/+|\/+$/g, "");
  return prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
}

export async function describeSources(
  program: string,
  connections: Connection[],
): Promise<InferredDescriptor[]> {
  const { coordinator, db } = await bootDuckDB();
  return introspect(program, {
    async resolve(ref) {
      const parsed = parseConnRef(ref.url);
      const connection = parsed
        ? connections.find((c) => c.kind === "data" && c.name === parsed.connName)
        : undefined;
      if (!parsed || !connection) throw new Error(`no data connection for ${ref.url}`);
      const signed = await api.connections.signUrls(connection.id, [parsed.path]);
      const url = signed[parsed.path];
      if (!url) throw new Error(`${ref.url} was not signed`);
      await db.registerFileURL(ref.url, url, DuckDBDataProtocol.HTTP, false);
      return ref.url;
    },
    async query(sql) {
      return (await coordinator.query(sql, { type: "json" })) as Record<string, unknown>[];
    },
  });
}
