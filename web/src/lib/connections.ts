import type { Schemas } from "@/lib/api/client";
import { schemaOf } from "@/components/spec-form";

export type Connection = Schemas["ConnectionView"];
export type Credential = Schemas["CredentialView"];
export type Purpose = Schemas["Purpose"];

/** A storage connection's prefix, kind and direction; `undefined` for a model one. */
export function storageOf(connection: Connection): Schemas["StorageTarget"] | undefined {
  return "storage" in connection.target ? connection.target.storage : undefined;
}

export function modelOf(connection: Connection): Schemas["ModelTarget"] | undefined {
  return "model" in connection.target ? connection.target.model : undefined;
}

/** A credential's purpose and its spec's inner object (`kind` and the non-secret fields). */
export function specOf(credential: Credential): { purpose: Purpose; spec: Record<string, unknown> } {
  return "storage" in credential.spec
    ? { purpose: "storage", spec: credential.spec.storage }
    : { purpose: "model", spec: credential.spec.model };
}

/** The title the contract gives a credential kind (`Amazon S3 / S3-compatible`). */
export function kindTitle(purpose: Purpose, kind: string): string {
  const schema = schemaOf(purpose === "storage" ? "StorageCredentialInput" : "ModelCredentialInput");
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
  return all.flatMap((c) => {
    const storage = storageOf(c);
    return storage
      ? [{ kind: "data", direction: "source", ...storage, name: c.name, credential: c.credential } as const]
      : [];
  });
}
