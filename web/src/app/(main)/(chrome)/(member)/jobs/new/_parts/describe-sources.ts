/**
 * Describe the sources a program reads, in the browser.
 *
 * Fossil says which sources those are and where each lives; `@fossil-lang/introspect`
 * owns the DESCRIBE each reader needs and the DuckDB→fossil type table. keasy
 * lends it the data plane: its {@link host} vends a read credential per source
 * connection, and the page's engine reads through it, by range, from the store.
 * The server never reads the file.
 */

import { introspect, type InferredDescriptor, type UndescribedSource } from "@fossil-lang/introspect";
import type { ProgramSource } from "@fossil-lang/types";

import { engine } from "@kanzo-tech/ui/analytics";

import { host } from "@/lib/fossil/host";
import type { StorageConnection } from "@/lib/connections";

/**
 * A file listed in a connection (its key in the bucket) as the path a program
 * writes after `@conn/`: relative to the connection's own prefix.
 */
export function connectionPath(connection: StorageConnection, key: string): string {
  const prefix = new URL(connection.url).pathname.replace(/^\/+|\/+$/g, "");
  return prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
}

export const sourceDescriptorsKey = (sources: readonly string[]) =>
  ["source-descriptors", sources] as const;

/** What could be described, and each source that could not, with its problem — shown, never dropped. */
export interface Described {
  descriptors: InferredDescriptor[];
  undescribed: UndescribedSource[];
}

export async function describeSources(sources: readonly ProgramSource[], signal?: AbortSignal): Promise<Described> {
  return introspect(sources, { host, engine: await engine({ signal }), signal });
}
