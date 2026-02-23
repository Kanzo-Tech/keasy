export type JobStatus = "draft" | "pending" | "running" | "completed" | "failed" | "cancelled";

export type RunMode = "integrated" | "scheduled";

export interface JobError {
  code: string;
  message: string;
  detail?: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  name?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: JobError;
  mode: RunMode;
  pipeline?: PipelineSummary;
  catalog?: string | null;
  connection_ids?: string[];
  script?: string;
}

export interface CreateJobRequest {
  script: string;
  name?: string;
  mode?: RunMode;
  pipeline?: PipelineSummary;
  dcat_enabled?: boolean;
  connection_ids?: string[];
  draft?: boolean;
}

export interface UpdateJobRequest {
  script?: string;
  name?: string;
}

export interface Field {
  name: string;
  type: string;
  uri?: string;
}

export interface PipelineInput {
  name: string;
  fields: Field[];
}

export interface FieldMapping {
  target: string;
  source: string;
}

export interface OperationInput {
  source: string;
  key_fields: string[];
}

export interface PipelineOperation {
  kind: string;
  label: string;
  fields: Field[];
  inputs: OperationInput[];
}

export interface PipelineOutput {
  type_name: string;
  fields: Field[];
  mappings?: FieldMapping[];
  source?: string;
  destination?: string;
  rdf_type?: string;
}

export interface PipelineSummary {
  inputs: PipelineInput[];
  operations: PipelineOperation[];
  outputs: PipelineOutput[];
}

export interface ValidationResult {
  valid: boolean;
  pipeline: PipelineSummary;
  errors: string[];
}

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

export interface CloudAccountSummary {
  id: string;
  name: string;
  provider_id: string;
  auth_method?: string;
  fields: Record<string, string>;
}

export interface CreateCloudAccountRequest {
  name: string;
  provider_id: string;
  auth_method?: string;
  fields: Record<string, string>;
}

export interface UpdateCloudAccountRequest {
  name?: string;
  auth_method?: string;
  fields?: Record<string, string>;
}

export interface OrgSettings {
  publisher_name: string;
  publisher_uri?: string;
  contact_email?: string;
  license_uri?: string;
  catalog_description?: string;
}

export interface Preferences {
  accent_color: string;
  font_family: string;
  mono_font_family: string;
  font_size: string;
  mono_font_size: string;
}

export type ConnectionKind = "data" | "vocab";
export type LocationType = "cloud" | "local";

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  location_type: LocationType;
  cloud_account_id?: string;
  url: string;
}

export interface CreateConnectionRequest {
  name: string;
  kind: ConnectionKind;
  location_type: LocationType;
  cloud_account_id?: string;
  url: string;
}

export interface UpdateConnectionRequest {
  name?: string;
  kind?: ConnectionKind;
  location_type?: LocationType;
  cloud_account_id?: string;
  url?: string;
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

export interface AiSettings {
  provider: string;
  api_key: string;
  model?: string;
  max_tokens?: number;
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
