import type { Schemas } from "@/lib/api/client";
import { schemaOf } from "@/lib/api/spec";

export type Connection = Schemas["ConnectionView"];
export type Credential = Schemas["CredentialView"];
/** The title the contract gives a credential kind (`Amazon S3 / S3-compatible`). */
export function kindTitle(kind: string): string {
  const schema = schemaOf("StorageCredentialInput");
  return (
    schema.oneOf?.find((b) => b.properties?.kind?.enum?.[0] === kind)?.title ?? kind.replaceAll("_", " ")
  );
}

/** A validation report, read as one word. */
export function validationStatus(report?: Schemas["ValidationReport"] | null): "passed" | "failed" | "unchecked" {
  if (!report || report.results.every((c) => c.result === "skip")) return "unchecked";
  return report.results.some((c) => c.result === "fail") ? "failed" : "passed";
}

/** A storage connection, flat: what the editor, the studio and the assistant read. */
export interface StorageConnection extends Required<Schemas["StorageTarget"]> {
  name: string;
  credential: string;
}

/** The storage connections among `all`, sources and sink alike. */
export function storageConnections(all: Connection[]): StorageConnection[] {
  return all.map((c) => ({ kind: "data", direction: "source", ...c.target, name: c.name, credential: c.credential }));
}

/**
 * The reference a program writes for a file listed in `connection` (its key in the bucket):
 * `@name/` and the key relative to the connection's own prefix.
 */
export function reference(connection: Pick<StorageConnection, "name" | "url">, key: string): string {
  const prefix = new URL(connection.url).pathname.replace(/^\/+|\/+$/g, "");
  const path = prefix && key.startsWith(`${prefix}/`) ? key.slice(prefix.length + 1) : key;
  return `@${connection.name}/${path}`;
}
