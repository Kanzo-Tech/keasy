export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

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
  sources?: SourceInfo[];
  outputs?: OutputInfo[];
  catalog?: string | null;
  cloud_account_ids?: string[];
}

export interface CreateJobRequest {
  script: string;
  name?: string;
  mode?: RunMode;
  sources?: SourceInfo[];
  outputs?: OutputInfo[];
  dcat_enabled?: boolean;
  cloud_account_ids?: string[];
}

export interface SourceInfo {
  name: string;
  fields: string[];
}

export interface FieldMapping {
  target: string;
  source: string;
}

export interface OutputInfo {
  source?: string;
  type_name: string;
  ctor_params: string[];
  fields: string[];
  destination: string | null;
  mappings?: FieldMapping[];
  field_types?: Record<string, string>;
  field_uris?: Record<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  sources: SourceInfo[];
  outputs: OutputInfo[];
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
  shiki_theme: string;
  accent_color: string;
  font_family: string;
  mono_font_family: string;
  font_size: string;
  mono_font_size: string;
}

export interface Connection {
  id: string;
  name: string;
  cloud_account_id: string;
  container_url: string;
}

export interface FileEntry {
  path: string;
  size: number;
  last_modified?: string;
}

export interface ShapeValidationResult {
  valid: boolean;
  conformant: number;
  non_conformant: number;
  errors: ShapeValidationError[];
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
}

export interface AskResponse {
  answer: string;
  sparql?: string;
  data?: TabularData;
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
