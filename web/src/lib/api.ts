import type {
  Job,
  CreateJobRequest,
  UpdateJobRequest,
  ValidationResult,
  ProviderSchema,
  ProviderInfo,
  OrgSettings,
  Preferences,
  AiSettings,
  AskResponse,
  GraphData,
  Conversation,
  ConversationMessage,
  FileEntry,
  SearchResult,
  ShapeValidationResult,
  TabularData,
  CloudAccountSummary,
  CreateCloudAccountRequest,
  UpdateCloudAccountRequest,
  Connection,
  CreateConnectionRequest,
  UpdateConnectionRequest,
  OrgUser,
} from "./types";

export class ApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function throwResponseError(
  res: Response,
  fallback: string
): Promise<never> {
  const body = await res.json().catch(() => null);
  // New flat format: { "error": "code", "message": "msg" }
  // Old nested format: { "error": { "code": "...", "message": "..." } }
  const code = (typeof body?.error === "string" ? body.error : body?.error?.code) ?? "unknown";
  const message = (typeof body?.error === "string" ? body?.message : body?.error?.message) ?? `${fallback} (${res.status})`;
  throw new ApiError(code, message);
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body != null ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) await throwResponseError(res, "Request failed");
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // Unwrap { "data": ... } envelope if present
  return json?.data !== undefined ? json.data : json;
}

const get = <T>(path: string) => request<T>(path, "GET");
const post = <T>(path: string, body?: unknown) => request<T>(path, "POST", body);
const put = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);
const del = (path: string) => request<void>(path, "DELETE");


export const fetchJobs = () => get<Job[]>("/api/jobs");
export const fetchJob = (id: string) => get<Job>(`/api/jobs/${id}`);
export const createJob = (req: CreateJobRequest) => post<Job>("/api/jobs", req);
export const updateJob = (id: string, req: UpdateJobRequest) => put<Job>(`/api/jobs/${id}`, req);
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


export function validateJob(
  dataUrl: string,
  sourceId: string,
  shapePath: string,
): Promise<ShapeValidationResult> {
  return post<ShapeValidationResult>("/api/validate", {
    data_url: dataUrl,
    connection_id: sourceId,
    shape_path: shapePath,
  });
}


export const fetchDashboardLayout = (jobId: string) =>
  get<Record<string, unknown> | undefined>(`/api/jobs/${jobId}/dashboard-layout`);
export const saveDashboardLayout = (jobId: string, layout: unknown) =>
  put<void>(`/api/jobs/${jobId}/dashboard-layout`, layout);


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
  post<{ loaded: boolean; triple_count: number; subject_count: number }>(`/api/jobs/${jobId}/discover/load`);

export const chartJobData = (
  jobId: string,
  request: {
    x_predicate: string;
    y_predicate?: string;
    group_predicate?: string;
    aggregation?: string;
  }
) => post<TabularData>(`/api/jobs/${jobId}/discover/chart`, request);

export const askDiscover = (jobId: string, question: string, conversationId?: string, provider?: string) =>
  post<AskResponse>(`/api/jobs/${jobId}/discover/ask`, {
    question, conversation_id: conversationId, ...(provider ? { provider } : {}),
  });


export const createConversation = (jobId: string, title?: string) =>
  post<Conversation>(`/api/jobs/${jobId}/conversations`, { title });
export const listConversations = (jobId: string) =>
  get<Conversation[]>(`/api/jobs/${jobId}/conversations`);
export const getMessages = (conversationId: string) =>
  get<ConversationMessage[]>(`/api/conversations/${conversationId}/messages`);
export const renameConversation = (conversationId: string, title: string) =>
  put<void>(`/api/conversations/${conversationId}`, { title });
export const deleteConversation = (conversationId: string) =>
  del(`/api/conversations/${conversationId}`);


export const fetchAiProviders = () => get<AiSettings[]>("/api/settings/ai/providers");
export const saveAiProvider = (providerId: string, config: { api_key: string; model?: string; max_tokens?: number }) =>
  put<AiSettings>(`/api/settings/ai/providers/${providerId}`, { ...config, provider: providerId });
export const deleteAiProvider = (providerId: string) =>
  del(`/api/settings/ai/providers/${providerId}`);


export const fetchSchema = () => get<ProviderSchema[]>("/api/settings/schema");
export const fetchProviders = () => get<ProviderInfo[]>("/api/providers");


export const fetchCloudAccounts = () => get<CloudAccountSummary[]>("/api/cloud-accounts");
export const fetchCloudAccount = (id: string) => get<CloudAccountSummary>(`/api/cloud-accounts/${id}`);
export const createCloudAccount = (req: CreateCloudAccountRequest) => post<CloudAccountSummary>("/api/cloud-accounts", req);
export const updateCloudAccount = (id: string, req: UpdateCloudAccountRequest) => put<CloudAccountSummary>(`/api/cloud-accounts/${id}`, req);
export const deleteCloudAccount = (id: string) => del(`/api/cloud-accounts/${id}`);



export const fetchPreferences = () => get<Preferences>("/api/settings/preferences");
export const savePreferences = (prefs: Preferences) => put<Preferences>("/api/settings/preferences", prefs);


export const fetchOrgSettings = () => get<OrgSettings | null>("/api/settings/organization");
export const saveOrgSettings = (settings: OrgSettings) => put<OrgSettings>("/api/settings/organization", settings);


export const fetchConnections = (type?: string) =>
  get<Connection[]>(type ? `/api/connections?type=${encodeURIComponent(type)}` : "/api/connections");
export const fetchConnection = (id: string) => get<Connection>(`/api/connections/${id}`);
export const createConnection = (req: CreateConnectionRequest) => post<Connection>("/api/connections", req);
export const updateConnection = (id: string, req: UpdateConnectionRequest) => put<Connection>(`/api/connections/${id}`, req);
export const deleteConnection = (id: string) => del(`/api/connections/${id}`);
export const fetchConnectionFiles = (id: string) => get<FileEntry[]>(`/api/connections/${id}/files`);


// Org user management
export const fetchOrgUsers = () => get<OrgUser[]>("/api/org/users");
export const updateOrgUserRole = (userId: string, role: string) =>
  put<OrgUser>(`/api/org/users/${userId}`, { role });
export const removeOrgUser = (userId: string) => del(`/api/org/users/${userId}`);

