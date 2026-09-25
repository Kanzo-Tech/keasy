/**
 * Describe the sources a program reads, in the browser.
 *
 * Fossil says which sources those are and where each lives; `@fossil-lang/introspect`
 * owns the DESCRIBE each reader needs and the DuckDB→fossil type table. keasy
 * lends it the data plane: its {@link sourceHost} signs the locators, and
 * DuckDB-WASM reads them straight from the store. The server never reads the file.
 */

import { introspect, type InferredDescriptor } from "@fossil-lang/introspect";
import type { ProgramSource } from "@fossil-lang/types";

import { DuckDBDataProtocol } from "@duckdb/duckdb-wasm";

import { bootDuckDB } from "@/lib/fossil/open-job-corpus";
import type { Schemas } from "@/lib/api/client";
import { sourceHost } from "./source-host";

/**
 * A file listed in a connection (its key in the bucket) as the path a program
 * writes after `@conn/`: relative to the connection's own prefix.
 */
export function connectionPath(connection: Schemas["Connection"], key: string): string {
  const prefix = new URL(connection.url).pathname.replace(/^\/+|\/+$/g, "");
  return prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
}

export const sourceDescriptorsKey = (sources: readonly string[]) =>
  ["source-descriptors", sources] as const;

export async function describeSources(sources: readonly ProgramSource[]): Promise<InferredDescriptor[]> {
  const { coordinator, db } = await bootDuckDB();
  return introspect(sources, {
    host: sourceHost,
    register: (name, url) => db.registerFileURL(name, url, DuckDBDataProtocol.HTTP, false),
    query: async (sql) => (await coordinator.query(sql, { type: "json" })) as Record<string, unknown>[],
  });
}
