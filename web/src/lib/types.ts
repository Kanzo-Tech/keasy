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
export type Preferences = S["Preferences"];
export type ConnectionKind = S["ConnectionKind"];
export type LocationType = S["LocationType"];
export type Connection = S["Connection"];
export type CreateConnectionRequest = S["CreateConnectionRequest"];
export type UpdateConnectionRequest = S["UpdateConnectionRequest"];
export type ColumnInfo = S["ColumnInfo"];
export type FileSchemaResponse = S["FileSchemaResponse"];
export type AiSettings = S["AiSettingsPayload"];

// Assistant types
export type FileSchema = S["FileSchema"];
export type CompetencyQuestion = S["CompetencyQuestion"];
export type SuggestRequest = S["SuggestRequest"];
export type SuggestResponse = S["SuggestResponse"];
export type GenerateRequest = S["GenerateRequest"];
export type GenerateResponse = S["GenerateResponse"];

// Alias: server calls it JobRuntimeError, frontend used JobError
export type JobError = S["JobRuntimeError"];

// Org types — re-exported from schema with frontend aliases
export type OrgIdentity = S["OrgIdentityResponse"];
export type OrgUser = S["WorkspaceMember"];

// ---------------------------------------------------------------------------
// Types now in OpenAPI spec — re-exported from schema
// ---------------------------------------------------------------------------

// The fossil subprocess run status — the job's GraphAr structure (Job.manifest).
// Column statistics are NOT here; the browser computes them via DuckDB-WASM.
export type RunStatus = S["RunStatus"];
export type VertexStatus = S["VertexStatus"];
export type EdgeStatus = S["EdgeStatus"];
export type ColumnStatus = S["ColumnStatus"];

// Override rows type — server uses serde_json::Value per cell, schema generates Record<string,never>
export type TabularData = Omit<S["TabularData"], "rows"> & {
  rows: Record<string, string | number | null>[];
};
export type Conversation = S["Conversation"];
// Override data type — schema generates rows: Record<string,never>[], we use Record<string, string|number|null>[]
// Add explanation field (populated by the explain stream, not yet in the OpenAPI spec)
export type ConversationMessage = Omit<S["ConversationMessage"], "data"> & {
  data?: TabularData | null;
  explanation?: string | null;
};
export type FileEntry = S["FileEntry"];
export type AskResponse = S["AskResponse"];


// Aliases for renamed/new response types
export type ServiceStatus = S["ServiceStatusResponse"];
export type LogoutResponse = S["LogoutResponse"];

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

export type MeResponse = S["MeResponse"];
export type WorkspaceSummary = S["WorkspaceSummary"];
export type WorkspacesResponse = S["WorkspacesResponse"];
