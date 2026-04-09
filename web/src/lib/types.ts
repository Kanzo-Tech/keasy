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
export type OrgSettings = S["OrgSettings"];
export type Preferences = S["Preferences"];
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

// GraphAr manifest types (from OpenAPI schema)
export type DataManifest = S["DataManifest"];
export type TypeManifest = S["TypeManifest"];
export type EdgeManifest = S["EdgeManifest"];
export type ColumnStat = S["ColumnStat"];

export type FileEntry = S["FileEntry"];


// Aliases for renamed/new response types
export type OrgInvite = S["OrgInviteEntry"];
export type ServiceStatus = S["ServiceStatusResponse"];
export type InviteInfoResponse = S["InviteInfoResponse"];
export type LogoutResponse = S["LogoutResponse"];
export type CreateOrgInviteResponse = S["CreateOrgInviteResponse"];
// ---------------------------------------------------------------------------
// Schema inference types (assistant wizard)
// TODO: ColumnInfo → S["ColumnInfo"] after openapi.json regeneration
// ---------------------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  type: string;
}

// Frontend-only: enriched schema for LLM prompt context
export interface FileSchema {
  connection_name: string;
  file_path: string;
  columns: ColumnInfo[];
}

// AI SDK type — not in OpenAPI spec
export interface CompetencyQuestion {
  id: string;
  question: string;
  rationale: string;
}

// ---------------------------------------------------------------------------
// UI-only union types
// ---------------------------------------------------------------------------

export type CreationMode = "studio" | "assistant";

// ---------------------------------------------------------------------------
// Connector types — re-exported from OpenAPI schema
// ---------------------------------------------------------------------------

export type ConnectorDirection = S["ConnectorDirection"];
export type Connector = S["Connector"];
export type CreateConnectorRequest = S["CreateConnectorRequest"];
export type UpdateConnectorRequest = S["UpdateConnectorRequest"];
export type ConnectorTypeDef = S["ConnectorTypeInfo"];

// ---------------------------------------------------------------------------
// Types NOT in the OpenAPI spec — remain manually defined (UI/static config)
// ---------------------------------------------------------------------------

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
// Fossil Analysis types (editor completions/diagnostics)
// ---------------------------------------------------------------------------

export interface FossilCompletionItem {
  label: string;
  kind: "property" | "method" | "function" | "variable" | "type" | "keyword" | "text" | "field";
  detail: string;
}

export interface FossilDiagnosticItem {
  from: number;
  to: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
}

export interface FossilAnalysis {
  completions: FossilCompletionItem[];
  diagnostics: FossilDiagnosticItem[];
}

// ---------------------------------------------------------------------------
// Admin types — re-exported from schema
// ---------------------------------------------------------------------------

export type AdminInvite = S["AdminInviteEntry"];
export type AdminInviteResult = S["AdminInviteResult"];
