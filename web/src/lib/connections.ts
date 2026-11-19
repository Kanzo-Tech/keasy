import { referenceTo } from "@fossil-lang/types";

import type { Schemas } from "@/lib/api/client";

export type Connection = Schemas["ConnectionView"];

/** A validation report, read as one word. */
export function validationStatus(report?: Schemas["ValidationReport"] | null): "passed" | "failed" | "unchecked" {
  if (!report || report.results.every((c) => c.result === "skip")) return "unchecked";
  return report.results.some((c) => c.result === "fail") ? "failed" : "passed";
}

/** A storage connection, flat: what the editor, the studio and the assistant read. */
export interface StorageConnection extends Required<Schemas["StorageTarget"]> {
  name: string;
}

/** The storage connections among `all`, sources and sink alike. */
export function storageConnections(all: Connection[]): StorageConnection[] {
  return all.map((c) => ({ direction: "source", ...c.target, name: c.name }));
}

/**
 * What a program writes for a file listed in `connection` — its key in the bucket — through that
 * connection: fossil's `referenceTo` over the file's URL, `@name/` and the key past the prefix.
 */
export function reference(connection: Pick<StorageConnection, "name" | "url">, key: string): string {
  const bucket = connection.url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*).*$/i, "$1");
  return referenceTo(`${bucket}/${key}`, { [connection.name]: connection.url });
}
