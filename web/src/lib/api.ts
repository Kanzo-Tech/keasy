import type {
  Job,
  CreateJobRequest,
  ValidationResult,
  ProviderSchema,
  OrgSettings,
  Preferences,
  AiSettings,
  AskResponse,
  GraphData,
  Connection,
  FileEntry,
  SearchResult,
  ShapeValidationResult,
  TabularData,
  CloudAccountSummary,
  CreateCloudAccountRequest,
  UpdateCloudAccountRequest,
} from "./types";

async function throwResponseError(
  res: Response,
  fallback: string
): Promise<never> {
  const body = await res.json().catch(() => null);
  throw new Error(body?.error?.message ?? `${fallback} (${res.status})`);
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body != null ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) await throwResponseError(res, "Request failed");
  if (res.status === 204) return undefined as T;
  return res.json();
}

const get = <T>(path: string) => request<T>(path, "GET");
const post = <T>(path: string, body?: unknown) => request<T>(path, "POST", body);
const put = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);
const del = (path: string) => request<void>(path, "DELETE");

// --- Jobs ---

export const fetchJobs = () => get<Job[]>("/api/jobs");
export const fetchJob = (id: string) => get<Job>(`/api/jobs/${id}`);
export const createJob = (req: CreateJobRequest) => post<Job>("/api/jobs", req);
export const cancelJob = (id: string) => post<Job>(`/api/jobs/${id}/cancel`);
export const deleteJob = (id: string) => del(`/api/jobs/${id}`);
export const fetchJobGraph = (id: string) => get<GraphData>(`/api/jobs/${id}/graph`);
export const fetchUnifiedGraph = () => get<GraphData>("/api/graph");

export async function fetchJobCatalog(id: string, format: string): Promise<string> {
  const data = await get<{ catalog: string }>(`/api/jobs/${id}/catalog?format=${encodeURIComponent(format)}`);
  return data.catalog;
}

export const validateScript = (script: string) =>
  post<ValidationResult>("/api/scripts/validate", { script });

// --- Shape Validation ---

export function validateJob(
  dataUrl: string,
  connectionId: string,
  shapePath: string,
  shapeMap?: string
): Promise<ShapeValidationResult> {
  const body: Record<string, string> = {
    data_url: dataUrl,
    connection_id: connectionId,
    shape_path: shapePath,
  };
  if (shapeMap) body.shape_map = shapeMap;
  return post<ShapeValidationResult>("/api/validate", body);
}

// --- Discovery ---

export function searchGraphNodes(query: string, jobId?: string): Promise<SearchResult[]> {
  const body: Record<string, unknown> = { query };
  if (jobId) body.job_id = jobId;
  return post<SearchResult[]>("/api/graph/search", body);
}

export function expandGraphNode(nodeId: string, jobId?: string): Promise<GraphData> {
  const body: Record<string, unknown> = { node_id: nodeId };
  if (jobId) body.job_id = jobId;
  return post<GraphData>("/api/graph/expand", body);
}

export const loadJobDiscovery = (jobId: string) =>
  post<{ loaded: boolean; triple_count: number }>(`/api/jobs/${jobId}/discover/load`);

export const queryJobSparql = (jobId: string, sparql: string) =>
  post<TabularData>(`/api/jobs/${jobId}/discover/query`, { sparql });

export const chartJobData = (
  jobId: string,
  request: {
    x_predicate: string;
    y_predicate?: string;
    group_predicate?: string;
    aggregation?: string;
  }
) => post<TabularData>(`/api/jobs/${jobId}/discover/chart`, request);

export const askDiscover = (jobId: string, question: string) =>
  post<AskResponse>(`/api/jobs/${jobId}/discover/ask`, { question });

// --- AI Settings ---

export const fetchAiSettings = () => get<AiSettings | null>("/api/settings/ai");
export const saveAiSettings = (settings: AiSettings) => put<AiSettings>("/api/settings/ai", settings);

// --- Schema ---

export const fetchSchema = () => get<ProviderSchema[]>("/api/settings/schema");

// --- Cloud Accounts ---

export const fetchCloudAccounts = () => get<CloudAccountSummary[]>("/api/cloud-accounts");
export const fetchCloudAccount = (id: string) => get<CloudAccountSummary>(`/api/cloud-accounts/${id}`);
export const createCloudAccount = (req: CreateCloudAccountRequest) => post<CloudAccountSummary>("/api/cloud-accounts", req);
export const updateCloudAccount = (id: string, req: UpdateCloudAccountRequest) => put<CloudAccountSummary>(`/api/cloud-accounts/${id}`, req);
export const deleteCloudAccount = (id: string) => del(`/api/cloud-accounts/${id}`);

// --- Connections ---

export const fetchConnections = () => get<Connection[]>("/api/connections");
export const createConnection = (req: { name: string; cloud_account_id: string; container_url: string }) =>
  post<Connection>("/api/connections", req);
export const deleteConnection = (id: string) => del(`/api/connections/${id}`);
export const fetchConnectionFiles = (id: string) => get<FileEntry[]>(`/api/connections/${id}/files`);

export async function downloadConnectionFile(id: string, path: string): Promise<string> {
  const data = await get<{ content: string }>(`/api/connections/${id}/files/download?path=${encodeURIComponent(path)}`);
  return data.content;
}

// --- Preferences ---

export const fetchPreferences = () => get<Preferences>("/api/settings/preferences");
export const savePreferences = (prefs: Preferences) => put<Preferences>("/api/settings/preferences", prefs);

// --- Organization Settings ---

export const fetchOrgSettings = () => get<OrgSettings | null>("/api/settings/organization");
export const saveOrgSettings = (settings: OrgSettings) => put<OrgSettings>("/api/settings/organization", settings);
