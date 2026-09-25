import type { Inputs, Schemas } from "@keasy/api";

// ---------------------------------------------------------------------------
// Re-export types generated from the OpenAPI spec (source of truth: server)
// ---------------------------------------------------------------------------

type S = Schemas;
type W = Inputs;

export type JobStatus = S["JobStatus"];
export type Job = S["Job"];
export type Dataset = S["Dataset"];
export type CloudAccountSummary = S["CloudAccountSummary"];
export type CreateCloudAccountRequest = W["CreateCloudAccountRequest"];
export type UpdateCloudAccountRequest = W["UpdateCloudAccountRequest"];
export type ConnectionKind = S["ConnectionKind"];
export type LocationType = S["LocationType"];
export type Connection = S["Connection"];
export type CreateConnectionRequest = W["CreateConnectionRequest"];
export type AiSettings = S["AiSettingsPayload"];
export type AiProvider = S["AiProvider"];


export type FileEntry = S["FileEntry"];
export type ChatMessage = S["ChatMessage"];


// ---------------------------------------------------------------------------
// Connection-provider registry schema — codegen'd from the OpenAPI spec
// (`/v1/settings/schema`), NOT hand-mirrored ([[feedback_schema_driven_ui]]).
// ---------------------------------------------------------------------------

export type FieldSchema = S["FieldSchema"];
export type AuthMethodSchema = S["AuthMethodSchema"];
export type ProviderSchema = S["ProviderSchema"];

// The source providers fossil supports, from `@fossil-lang/wasm`'s `providers()`.
export type { ProviderInfo } from "@fossil-lang/wasm";

// ---------------------------------------------------------------------------
// Auth types — re-exported from schema
// ---------------------------------------------------------------------------

export type WorkspacesResponse = S["WorkspacesResponse"];
