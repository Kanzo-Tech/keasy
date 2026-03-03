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
export type Field = S["Field"];
export type PipelineOutput = S["PipelineOutput"];
export type PipelineSummary = S["PipelineSummary"];
export type ValidationResult = S["ValidationResult"];
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
export type AiSettings = S["AiSettingsPayload"];

// Alias: server calls it JobRuntimeError, frontend used JobError
export type JobError = S["JobRuntimeError"];

// Org types — re-exported from schema with frontend aliases
export type OrgIdentity = S["OrgIdentityResponse"];
export type OrgUser = S["OrgMember"];
export type OrgEntry = S["Organization"];

// ---------------------------------------------------------------------------
// Types now in OpenAPI spec — re-exported from schema
// ---------------------------------------------------------------------------

export type SearchResult = S["SearchResult"];
// Override rows type — server uses serde_json::Value per cell, schema generates Record<string,never>
export type TabularData = Omit<S["TabularData"], "rows"> & {
  rows: Record<string, string | number | null>[];
};
export type GraphData = S["GraphData"];
export type GraphNode = S["GraphNode"];
export type GraphLink = S["GraphLink"];
export type Conversation = S["Conversation"];
// Override data type — schema generates rows: Record<string,never>[], we use Record<string, string|number|null>[]
export type ConversationMessage = Omit<S["ConversationMessage"], "data"> & {
  data?: TabularData | null;
};
export type FileEntry = S["FileEntry"];
export type AskResponse = S["AskResponse"];

// Shape validation — now in OpenAPI schema
export type ShapeValidationResult = S["ShapeValidationResult"];

// Aliases for renamed/new response types
export type OrgInvite = S["OrgInviteEntry"];
export type ServiceStatus = S["ServiceStatusResponse"];
export type InviteInfoResponse = S["InviteInfoResponse"];
export type LogoutResponse = S["LogoutResponse"];
export type CreateOrgInviteResponse = S["CreateOrgInviteResponse"];
export type CatalogResponse = S["CatalogResponse"];

// ---------------------------------------------------------------------------
// Types NOT in the OpenAPI spec — remain manually defined (UI/static config)
// ---------------------------------------------------------------------------

export interface FieldSchema {
  name: string;
  label: string;
  secret: boolean;
  optional?: boolean;
  default_value?: string;
  env_var?: string;
}

export interface AuthMethodSchema {
  name: string;
  label: string;
  fields: FieldSchema[];
}

export interface ProviderSchema {
  id: string;
  label: string;
  icon: string;
  common_fields: FieldSchema[];
  auth_methods: AuthMethodSchema[];
}

export interface ProviderInfo {
  name: string;
  extensions: string[];
  kind: "schema" | "data" | "both";
}

// ---------------------------------------------------------------------------
// Auth types — re-exported from schema
// ---------------------------------------------------------------------------

export type MeResponse = S["MeResponse"];
export type Workspace = S["Workspace"];
export type WorkspacesResponse = S["WorkspacesResponse"];

// ---------------------------------------------------------------------------
// Gaia-X Compliance types — re-exported from schema
// ---------------------------------------------------------------------------

export type ComplianceCredential = S["ComplianceCredential"];
export type ComplyEvent = S["ComplyEvent"];
export type JobEvent = S["JobEvent"];

// ---------------------------------------------------------------------------
// Admin types — re-exported from schema
// ---------------------------------------------------------------------------

export type AdminInvite = S["AdminInviteEntry"];
export type AdminInviteResult = S["AdminInviteResult"];
