import { referenceTo } from "@fossil-lang/types";

import type { Inputs, Schemas } from "@/lib/api/client";
import { schemaOf } from "@/lib/api/spec";

export type Connection = Schemas["ConnectionView"];
export type Credential = Schemas["SecretView"];
type Kind = Inputs["SecretSpec"]["kind"];

/**
 * The clouds a credential is for, each with the scheme its locations are written in and its ways
 * of signing in — the credential kinds the contract publishes, grouped by the store they reach.
 */
export const CLOUDS = [
  {
    value: "aws",
    label: "AWS",
    holds: "Amazon S3",
    scheme: "s3://",
    methods: [{ kind: "s3", label: "Access key" }],
  },
  {
    value: "azure",
    label: "Azure",
    holds: "Blob Storage, ADLS",
    scheme: "az://",
    methods: [
      { kind: "azure_account_key", label: "Account key" },
      { kind: "azure_service_principal", label: "Service principal" },
    ],
  },
] as const satisfies readonly { value: string; label: string; holds: string; scheme: string; methods: readonly { kind: Kind; label: string }[] }[];

export type Cloud = (typeof CLOUDS)[number];

/** The cloud a credential kind reaches. */
export function cloudOf(kind: string): Cloud {
  return CLOUDS.find((c) => c.methods.some((m) => m.kind === kind)) ?? CLOUDS[0];
}

/** The title the contract gives a credential kind (`Amazon S3`). */
export function kindTitle(kind: string): string {
  const schema = schemaOf("SecretSpec");
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
  /** The secret it signs with. */
  secret: string;
}

/** The storage connections among `all`, sources and sink alike. */
export function storageConnections(all: Connection[]): StorageConnection[] {
  return all.map((c) => ({ kind: "data", direction: "source", ...c.target, name: c.name, secret: c.secret }));
}

/**
 * What a program writes for a file listed in `connection` — its key in the bucket — through that
 * connection: fossil's `referenceTo` over the file's URL, `@name/` and the key past the prefix.
 */
export function reference(connection: Pick<StorageConnection, "name" | "url">, key: string): string {
  const bucket = connection.url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]*).*$/i, "$1");
  return referenceTo(`${bucket}/${key}`, { [connection.name]: connection.url });
}
