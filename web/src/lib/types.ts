import type { components } from "./api/schema";

// ---------------------------------------------------------------------------
// Re-export types generated from the OpenAPI spec (source of truth: server)
// ---------------------------------------------------------------------------

type S = components["schemas"];

export type JobStatus = S["JobStatus"];
export type RunMode = S["RunMode"];
export type Job = S["Job"];
export type CreateJobRequest = S["CreateJobRequest"];
export type UpdateJobRequest = S["UpdateJobRequest"];
export type CatalogDataset = S["CatalogDataset"];
export type CatalogTable = S["CatalogTable"];
export type CatalogColumn = S["CatalogColumn"];
export type CloudAccountSummary = S["CloudAccountSummary"];
export type CreateCloudAccountRequest = S["CreateCloudAccountRequest"];
export type UpdateCloudAccountRequest = S["UpdateCloudAccountRequest"];
export type OrgSettings = S["OrgSettings"];
export type ConnectionKind = S["ConnectionKind"];
export type LocationType = S["LocationType"];
export type Connection = S["Connection"];
export type CreateConnectionRequest = S["CreateConnectionRequest"];
export type ColumnInfo = S["ColumnInfo"];
export type AiSettings = S["AiSettingsPayload"];
export type AiProvider = S["AiProvider"];

// Assistant types
export type FileSchema = S["FileSchema"];
export type CompetencyQuestion = S["CompetencyQuestion"];
export type SuggestRequest = S["SuggestRequest"];
export type SuggestResponse = S["SuggestResponse"];
export type GenerateRequest = S["GenerateRequest"];
export type GenerateResponse = S["GenerateResponse"];

// Alias: server calls it JobRuntimeError, frontend used JobError
export type JobError = S["JobRuntimeError"];

export type OrgIdentity = S["OrgIdentity"];

export type FileEntry = S["FileEntry"];
export type ChatMessage = S["ChatMessage"];


// ---------------------------------------------------------------------------
// UI-only union types
// ---------------------------------------------------------------------------

export type CreationMode = "studio" | "assistant";

// ---------------------------------------------------------------------------
// Connection-provider registry schema — codegen'd from the OpenAPI spec
// (`/v1/settings/schema`), NOT hand-mirrored ([[feedback_schema_driven_ui]]).
// ---------------------------------------------------------------------------

export type FieldSchema = S["FieldSchema"];
export type AuthMethodSchema = S["AuthMethodSchema"];
export type ProviderSchema = S["ProviderSchema"];

// Data-source providers fossil supports. Sourced from `@fossil-lang/wasm` (the
// rmlext package — client-compute `providers()`), NOT openapi: keasy no longer
// serves /v1/providers. Same `fossil_run_status::ProviderInfo` shape.
export type { ProviderInfo } from "@fossil-lang/wasm";

// ---------------------------------------------------------------------------
// Auth types — re-exported from schema
// ---------------------------------------------------------------------------

export type WorkspacesResponse = S["WorkspacesResponse"];
