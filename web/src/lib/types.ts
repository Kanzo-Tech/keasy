import type { Schemas } from "@keasy/api";

// ---------------------------------------------------------------------------
// Re-export types generated from the OpenAPI spec (source of truth: server)
// ---------------------------------------------------------------------------

type S = Schemas;

export type JobStatus = S["JobStatus"];
export type Job = S["Job"];
export type ConnectionKind = S["ConnectionKind"];
export type { StorageConnection as Connection } from "@/lib/connections";


export type FileEntry = S["FileEntry"];


// ---------------------------------------------------------------------------

// The source providers fossil supports, from `@fossil-lang/wasm`'s `providers()`.
export type { ProviderInfo } from "@fossil-lang/wasm";
