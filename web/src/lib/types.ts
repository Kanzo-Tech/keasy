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
export type FieldMapping = S["FieldMapping"];
export type OperationInput = S["OperationInput"];
export type PipelineInput = S["PipelineInput"];
export type PipelineOperation = S["PipelineOperation"];
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
export type OrgUser = S["UserWithRole"];
export type OrgEntry = S["Organization"];

// ---------------------------------------------------------------------------
// Types NOT in the OpenAPI spec (discovery, graph, conversations, etc.)
// These remain manually defined until their server response types are annotated.
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

export interface FileEntry {
  path: string;
  size: number;
  last_modified?: string;
}

export interface ShapeValidationResult {
  valid: boolean;
  errors: ShapeValidationError[];
  valid_nodes: string[];
}

export interface ShapeValidationError {
  node: string;
  message: string;
}

export interface SearchResult {
  id: string;
  label: string;
  group: string;
}

export interface TabularData {
  columns: string[];
  rows: Record<string, string | number>[];
  column_types: Record<string, "numeric" | "string">;
}

export interface AskResponse {
  answer: string;
  sparql?: string;
  data?: TabularData;
  conversation_id?: string;
  code: string;
}

export interface Conversation {
  id: string;
  job_id: string;
  created_at: string;
  title?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sparql?: string;
  data?: TabularData;
  code?: string;
  created_at: string;
}

export interface ProviderInfo {
  name: string;
  extensions: string[];
  kind: "schema" | "data" | "both";
}

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  properties?: Record<string, string>;
}

export interface GraphLink {
  source: string;
  target: string;
  label: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface OrgInvite {
  token: string;
  role: string;
  status: "active" | "expired";
  created_at: string;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// Auth types
// ---------------------------------------------------------------------------

export interface MeResponse {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  effective_role: string;
  vc_holder_did?: string;
  wallet_connected_at?: string;
  org?: {
    id: string;
    name: string;
    role: string;
    vc_verified_at: string | null;
  };
}

export interface Workspace {
  client_id: string;
  name: string;
  url: string;
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
  current_client_id: string;
}

// ---------------------------------------------------------------------------
// Gaia-X Compliance / Wizard types
// ---------------------------------------------------------------------------

export interface WizardState {
  current_step?: number;
  domain?: string;
  public_key_jwk?: Record<string, unknown>;
  did_document?: Record<string, unknown>;
  cert_chain_pem?: string;
  lrn_type?: string;
  lrn_value?: string;
  lrn_credential?: Record<string, unknown>;
  legal_name?: string;
  country_code?: string;
  lp_credential?: Record<string, unknown>;
  tc_credential?: Record<string, unknown>;
  compliance_vc?: Record<string, unknown>;
}

export interface ComplianceCredential {
  name: string;
  issued_at: string;
  raw_json: Record<string, unknown>;
}

export interface ComplianceStatus {
  compliant: boolean;
  verified_at?: string | null;
  credentials: ComplianceCredential[];
  wizard_state?: WizardState;
}

// ---------------------------------------------------------------------------
// Wallet types
// ---------------------------------------------------------------------------

export interface WalletStatus {
  connected: boolean;
  did?: string;
  connected_at?: string;
}

export interface WalletSession {
  session_id: string;
  qr_url: string;
}

// ---------------------------------------------------------------------------
// Admin types
// ---------------------------------------------------------------------------

export interface AdminInvite {
  token: string;
  org_id: string;
  org_name: string;
  status: "active" | "expired";
  created_at: string;
  expires_at: string;
}

export interface AdminInviteResult {
  token: string;
  org_id: string;
  org_name: string;
  invite_url: string;
}
