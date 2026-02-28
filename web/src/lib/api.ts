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
  OrgIdentity,
  OrgInvite,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function throwResponseError(
  res: Response,
  fallback: string,
): Promise<never> {
  const body = await res.json().catch(() => null);
  const code =
    (typeof body?.error === "string" ? body.error : body?.error?.code) ??
    "unknown";
  const message =
    (typeof body?.error === "string" ? body?.message : body?.error?.message) ??
    `${fallback} (${res.status})`;
  throw new ApiError(code, message);
}

async function request<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body != null
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!res.ok) await throwResponseError(res, "Request failed");
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // Unwrap { "data": ... } envelope if present
  return json?.data !== undefined ? json.data : json;
}

const get = <T>(path: string) => request<T>(path, "GET");
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, "POST", body);
const put = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);
const del = (path: string) => request<void>(path, "DELETE");

export const fetchJobs = () => get<Job[]>("/v1/jobs");
export const fetchJob = (id: string) => get<Job>(`/v1/jobs/${id}`);
export const createJob = (req: CreateJobRequest) => post<Job>("/v1/jobs", req);
export const updateJob = (id: string, req: UpdateJobRequest) =>
  put<Job>(`/v1/jobs/${id}`, req);
export const cancelJob = (id: string) => post<Job>(`/v1/jobs/${id}/cancel`);
export const deleteJob = (id: string) => del(`/v1/jobs/${id}`);
export const fetchJobGraph = (id: string) =>
  get<GraphData>(`/v1/jobs/${id}/graph`);
export const fetchUnifiedGraph = () => get<GraphData>("/v1/graph");
export const fetchAdminGraph = (orgId?: string) =>
  get<GraphData>(orgId ? `/v1/graph?org_id=${encodeURIComponent(orgId)}` : "/v1/graph");

export async function fetchJobCatalog(
  id: string,
  format: string,
): Promise<string> {
  const data = await get<{ catalog: string }>(
    `/v1/jobs/${id}/catalog?format=${encodeURIComponent(format)}`,
  );
  return data.catalog;
}

export const validateScript = (script: string) =>
  post<ValidationResult>("/v1/scripts/validate", { script });

export function validateJob(
  dataUrl: string,
  sourceId: string,
  shapePath: string,
): Promise<ShapeValidationResult> {
  return post<ShapeValidationResult>("/v1/validate", {
    data_url: dataUrl,
    connection_id: sourceId,
    shape_path: shapePath,
  });
}

export const fetchDashboardLayout = (jobId: string) =>
  get<Record<string, unknown> | undefined>(
    `/v1/jobs/${jobId}/dashboard-layout`,
  );
export const saveDashboardLayout = (jobId: string, layout: unknown) =>
  put<void>(`/v1/jobs/${jobId}/dashboard-layout`, layout);

export function searchGraphNodes(
  query: string,
  jobId?: string,
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = { query };
  if (jobId) body.job_id = jobId;
  return post<SearchResult[]>("/v1/graph/search", body);
}

export function expandGraphNode(
  nodeId: string,
  jobId?: string,
): Promise<GraphData> {
  const body: Record<string, unknown> = { node_id: nodeId };
  if (jobId) body.job_id = jobId;
  return post<GraphData>("/v1/graph/expand", body);
}

export const loadJobDiscovery = (jobId: string) =>
  post<{ loaded: boolean; triple_count: number; subject_count: number }>(
    `/v1/jobs/${jobId}/discover/load`,
  );

export const chartJobData = (
  jobId: string,
  request: {
    x_predicate: string;
    y_predicate?: string;
    group_predicate?: string;
    aggregation?: string;
  },
) => post<TabularData>(`/v1/jobs/${jobId}/discover/chart`, request);

export const askDiscover = (
  jobId: string,
  question: string,
  conversationId?: string,
  provider?: string,
) =>
  post<AskResponse>(`/v1/jobs/${jobId}/discover/ask`, {
    question,
    conversation_id: conversationId,
    ...(provider ? { provider } : {}),
  });

export const createConversation = (jobId: string, title?: string) =>
  post<Conversation>(`/v1/jobs/${jobId}/conversations`, { title });
export const listConversations = (jobId: string) =>
  get<Conversation[]>(`/v1/jobs/${jobId}/conversations`);
export const getMessages = (conversationId: string) =>
  get<ConversationMessage[]>(`/v1/conversations/${conversationId}/messages`);
export const renameConversation = (conversationId: string, title: string) =>
  put<void>(`/v1/conversations/${conversationId}`, { title });
export const deleteConversation = (conversationId: string) =>
  del(`/v1/conversations/${conversationId}`);

export const fetchAiProviders = () =>
  get<AiSettings[]>("/v1/settings/ai/providers");
export const saveAiProvider = (
  providerId: string,
  config: { api_key: string; model?: string; max_tokens?: number },
) =>
  put<AiSettings>(`/v1/settings/ai/providers/${providerId}`, {
    ...config,
    provider: providerId,
  });
export const deleteAiProvider = (providerId: string) =>
  del(`/v1/settings/ai/providers/${providerId}`);

export const fetchSchema = () => get<ProviderSchema[]>("/v1/settings/schema");
export const fetchProviders = () => get<ProviderInfo[]>("/v1/providers");

export const fetchCloudAccounts = () =>
  get<CloudAccountSummary[]>("/v1/cloud-accounts");
export const fetchCloudAccount = (id: string) =>
  get<CloudAccountSummary>(`/v1/cloud-accounts/${id}`);
export const createCloudAccount = (req: CreateCloudAccountRequest) =>
  post<CloudAccountSummary>("/v1/cloud-accounts", req);
export const updateCloudAccount = (
  id: string,
  req: UpdateCloudAccountRequest,
) => put<CloudAccountSummary>(`/v1/cloud-accounts/${id}`, req);
export const deleteCloudAccount = (id: string) =>
  del(`/v1/cloud-accounts/${id}`);

export const fetchPreferences = () =>
  get<Preferences>("/v1/settings/preferences");
export const savePreferences = (prefs: Preferences) =>
  put<Preferences>("/v1/settings/preferences", prefs);

export const fetchOrgSettings = () =>
  get<OrgSettings | null>("/v1/settings/organization");
export const saveOrgSettings = (settings: OrgSettings) =>
  put<OrgSettings>("/v1/settings/organization", settings);

export const fetchOrgIdentity = () => get<OrgIdentity>("/v1/org/identity");
export const saveOrgIdentity = (data: OrgIdentity) => put<OrgIdentity>("/v1/org/identity", data);

export const fetchConnections = (type?: string) =>
  get<Connection[]>(
    type
      ? `/v1/connections?type=${encodeURIComponent(type)}`
      : "/v1/connections",
  );
export const fetchConnection = (id: string) =>
  get<Connection>(`/v1/connections/${id}`);
export const createConnection = (req: CreateConnectionRequest) =>
  post<Connection>("/v1/connections", req);
export const updateConnection = (id: string, req: UpdateConnectionRequest) =>
  put<Connection>(`/v1/connections/${id}`, req);
export const deleteConnection = (id: string) => del(`/v1/connections/${id}`);
export const fetchConnectionFiles = (id: string) =>
  get<FileEntry[]>(`/v1/connections/${id}/files`);

// Org user management
export const fetchOrgUsers = () => get<OrgUser[]>("/v1/org/users");
export const updateOrgUserRole = (userId: string, role: string) =>
  put<OrgUser>(`/v1/org/users/${userId}`, { role });
export const removeOrgUser = (userId: string) => del(`/v1/org/users/${userId}`);

// Org invite management
export const createOrgInvite = (role: string) =>
  post<{ token: string; invite_url: string }>("/v1/org/invites", { role });
export const fetchOrgInvites = () => get<OrgInvite[]>("/v1/org/invites");
export const revokeOrgInvite = (token: string) => del(`/v1/org/invites/${token}`);

// Service status
export interface ServiceStatus {
  wallet: boolean;
  oidc: boolean;
  gxdch_notary: boolean;
  gxdch_compliance: boolean;
}

export const fetchServiceStatus = () => get<ServiceStatus>("/v1/status");
