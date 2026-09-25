import type { Inputs, Schemas } from "@keasy/api";

// ---------------------------------------------------------------------------
// Re-export types generated from the OpenAPI spec (source of truth: server)
// ---------------------------------------------------------------------------

type S = Schemas;
type W = Inputs;

export type JobStatus = S["JobStatus"];
export type Job = S["Job"];
export type CreateJobRequest = W["CreateJobRequest"];
export type UpdateJobRequest = W["UpdateJobRequest"];
export type Dataset = S["Dataset"];
export type OutputRelation = S["OutputRelation"];
export type ConnectionKind = S["ConnectionKind"];
export type { StorageConnection as Connection } from "@/lib/connections";


export type FileEntry = S["FileEntry"];
export type ChatMessage = S["ChatMessage"];


// ---------------------------------------------------------------------------
// UI-only union types
// ---------------------------------------------------------------------------

export type CreationMode = "studio" | "assistant";

// The source providers fossil supports, from `@fossil-lang/wasm`'s `providers()`.
export type { ProviderInfo } from "@fossil-lang/wasm";

// ---------------------------------------------------------------------------
// Auth types — re-exported from schema
// ---------------------------------------------------------------------------

export type WorkspacesResponse = S["WorkspacesResponse"];
