import client, { ApiError } from "./api/client";
import type { Schemas } from "./api/client";
import type {
  ValidationResult,
  ProviderSchema,
  ProviderInfo,
  AskResponse,
  GraphData,
  Conversation,
  ConversationMessage,
  FileEntry,
  SearchResult,
  ShapeValidationResult,
  TabularData,
  OrgUser,
  OrgIdentity,
  OrgInvite,
  MeResponse,
  WorkspacesResponse,
  WizardState,
  ComplianceStatus,
  WalletStatus,
  WalletSession,
  OrgEntry,
  AdminInvite,
  AdminInviteResult,
} from "./types";

export { ApiError };

// ---------------------------------------------------------------------------
// Internal helper for endpoints NOT in the OpenAPI spec (discovery, conversations,
// compliance, admin, etc.). These keep the old manual fetch pattern until
// their utoipa annotations are added on the server.
// ---------------------------------------------------------------------------

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
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const code =
      (typeof json?.error === "string" ? json.error : json?.error?.code) ??
      "unknown";
    const message =
      (typeof json?.error === "string"
        ? json?.message
        : json?.error?.message) ?? `Request failed (${res.status})`;
    throw new ApiError(code, message);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return json?.data !== undefined ? json.data : json;
}

const get = <T>(path: string) => request<T>(path, "GET");
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, "POST", body);
const put = <T>(path: string, body: unknown) => request<T>(path, "PUT", body);
const del = (path: string) => request<void>(path, "DELETE");

// ---------------------------------------------------------------------------
// Helper to unwrap openapi-fetch result (throws on error, returns data)
// ---------------------------------------------------------------------------

function unwrap<T>(result: { data?: T; error?: unknown }): T {
  // Errors are already thrown by the middleware, but safety-check.
  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new ApiError("unknown", String(result.error));
  }
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Jobs — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchJobs = async () =>
  unwrap(await client.GET("/v1/jobs"));

export const fetchJob = async (id: string) =>
  unwrap(await client.GET("/v1/jobs/{id}", { params: { path: { id } } }));

export const createJob = async (req: Schemas["CreateJobRequest"]) =>
  unwrap(await client.POST("/v1/jobs", { body: req }));

export const updateJob = async (id: string, req: Schemas["UpdateJobRequest"]) =>
  unwrap(
    await client.PUT("/v1/jobs/{id}", { params: { path: { id } }, body: req }),
  );

export const cancelJob = async (id: string) =>
  unwrap(
    await client.POST("/v1/jobs/{id}/cancel", { params: { path: { id } } }),
  );

export const deleteJob = async (id: string) => {
  unwrap(
    await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }),
  );
};

// Jobs — endpoints not fully typed in OpenAPI (returns ad-hoc JSON)
export const fetchJobGraph = (id: string) =>
  get<GraphData>(`/v1/jobs/${id}/graph`);
export const fetchUnifiedGraph = () => get<GraphData>("/v1/graph");
export const fetchAdminGraph = (orgId?: string) =>
  get<GraphData>(
    orgId
      ? `/v1/graph?org_id=${encodeURIComponent(orgId)}`
      : "/v1/graph",
  );

export async function fetchJobCatalog(
  id: string,
  format: string,
): Promise<string> {
  const data = await get<{ catalog: string }>(
    `/v1/jobs/${id}/catalog?format=${encodeURIComponent(format)}`,
  );
  return data.catalog;
}

// ---------------------------------------------------------------------------
// Scripts — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const validateScript = async (script: string) =>
  unwrap(
    await client.POST("/v1/scripts/validate", {
      body: { script },
    }),
  );

// ---------------------------------------------------------------------------
// Validation — not in OpenAPI
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Dashboard — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchDashboardLayout = (jobId: string) =>
  get<Record<string, unknown> | undefined>(
    `/v1/jobs/${jobId}/dashboard-layout`,
  );
export const saveDashboardLayout = (jobId: string, layout: unknown) =>
  put<void>(`/v1/jobs/${jobId}/dashboard-layout`, layout);

// ---------------------------------------------------------------------------
// Graph search/expand — not in OpenAPI
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Discovery — not in OpenAPI
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Conversations — not in OpenAPI
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AI Providers — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchAiProviders = async () =>
  unwrap(await client.GET("/v1/settings/ai/providers"));

export const saveAiProvider = async (
  providerId: string,
  config: { api_key: string; model?: string; max_tokens?: number },
) =>
  unwrap(
    await client.PUT("/v1/settings/ai/providers/{provider_id}", {
      params: { path: { provider_id: providerId } },
      body: { ...config, provider: providerId },
    }),
  );

export const deleteAiProvider = async (providerId: string) => {
  unwrap(
    await client.DELETE("/v1/settings/ai/providers/{provider_id}", {
      params: { path: { provider_id: providerId } },
    }),
  );
};

// ---------------------------------------------------------------------------
// Settings schema/providers — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchSchema = () => get<ProviderSchema[]>("/v1/settings/schema");
export const fetchProviders = () => get<ProviderInfo[]>("/v1/providers");

// ---------------------------------------------------------------------------
// Cloud Accounts — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchCloudAccounts = async () =>
  unwrap(await client.GET("/v1/cloud-accounts"));

export const fetchCloudAccount = async (id: string) =>
  unwrap(
    await client.GET("/v1/cloud-accounts/{id}", {
      params: { path: { id } },
    }),
  );

export const createCloudAccount = async (
  req: Schemas["CreateCloudAccountRequest"],
) => unwrap(await client.POST("/v1/cloud-accounts", { body: req }));

export const updateCloudAccount = async (
  id: string,
  req: Schemas["UpdateCloudAccountRequest"],
) =>
  unwrap(
    await client.PUT("/v1/cloud-accounts/{id}", {
      params: { path: { id } },
      body: req,
    }),
  );

export const deleteCloudAccount = async (id: string) => {
  unwrap(
    await client.DELETE("/v1/cloud-accounts/{id}", {
      params: { path: { id } },
    }),
  );
};

// ---------------------------------------------------------------------------
// Preferences — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchPreferences = async () =>
  unwrap(await client.GET("/v1/settings/preferences"));

export const savePreferences = async (prefs: Schemas["Preferences"]) =>
  unwrap(
    await client.PUT("/v1/settings/preferences", { body: prefs }),
  );

// ---------------------------------------------------------------------------
// Org Settings — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchOrgSettings = async () => {
  const result = await client.GET("/v1/settings/organization");
  // 204 means no settings configured → return null
  if (result.data === undefined) return null;
  return result.data as Schemas["OrgSettings"];
};

export const saveOrgSettings = async (settings: Schemas["OrgSettings"]) =>
  unwrap(
    await client.PUT("/v1/settings/organization", { body: settings }),
  );

// ---------------------------------------------------------------------------
// Org Identity — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchOrgIdentity = () => get<OrgIdentity>("/v1/org/identity");
export const saveOrgIdentity = (data: OrgIdentity) =>
  put<OrgIdentity>("/v1/org/identity", data);

// ---------------------------------------------------------------------------
// Connections — fully typed via OpenAPI
// ---------------------------------------------------------------------------

export const fetchConnections = async (type?: string) =>
  unwrap(
    await client.GET("/v1/connections", {
      params: { query: type ? { type } : {} },
    }),
  );

export const fetchConnection = async (id: string) =>
  unwrap(
    await client.GET("/v1/connections/{id}", { params: { path: { id } } }),
  );

export const createConnection = async (
  req: Schemas["CreateConnectionRequest"],
) => unwrap(await client.POST("/v1/connections", { body: req }));

export const updateConnection = async (
  id: string,
  req: Schemas["UpdateConnectionRequest"],
) =>
  unwrap(
    await client.PUT("/v1/connections/{id}", {
      params: { path: { id } },
      body: req,
    }),
  );

export const deleteConnection = async (id: string) => {
  unwrap(
    await client.DELETE("/v1/connections/{id}", { params: { path: { id } } }),
  );
};

export const fetchConnectionFiles = (id: string) =>
  get<FileEntry[]>(`/v1/connections/${id}/files`);

// ---------------------------------------------------------------------------
// Org user management — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchOrgUsers = () => get<OrgUser[]>("/v1/org/users");
export const updateOrgUserRole = (userId: string, role: string) =>
  put<OrgUser>(`/v1/org/users/${userId}`, { role });
export const removeOrgUser = (userId: string) =>
  del(`/v1/org/users/${userId}`);

// ---------------------------------------------------------------------------
// Org invite management — not in OpenAPI
// ---------------------------------------------------------------------------

export const createOrgInvite = (role: string) =>
  post<{ token: string; invite_url: string }>("/v1/org/invites", { role });
export const fetchOrgInvites = () => get<OrgInvite[]>("/v1/org/invites");
export const revokeOrgInvite = (token: string) =>
  del(`/v1/org/invites/${token}`);

// ---------------------------------------------------------------------------
// Service status — not fully typed in OpenAPI (returns ad-hoc JSON)
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  wallet: boolean;
  issuer: boolean;
  oidc: boolean;
  gxdch_notary: boolean;
  gxdch_compliance: boolean;
  base_domain: string | null;
}

export const fetchServiceStatus = () => get<ServiceStatus>("/v1/status");

// ---------------------------------------------------------------------------
// Auth — not in OpenAPI (response types are ad-hoc)
// ---------------------------------------------------------------------------

export const fetchAuthMe = () => get<MeResponse>("/v1/auth/me");
export const fetchWorkspaces = () =>
  get<WorkspacesResponse>("/v1/auth/workspaces");
export const logout = () =>
  post<{ end_session_url?: string }>("/v1/auth/logout");
export const fetchInviteInfo = (token: string) =>
  get<{ email?: string }>(`/v1/auth/invite-info?token=${encodeURIComponent(token)}`);

// ---------------------------------------------------------------------------
// Gaia-X Compliance — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchComplianceStatus = () =>
  get<ComplianceStatus>("/v1/gaia-x/compliance");
export const rerunCompliance = () =>
  post<{ compliant: boolean; compliance_vc?: unknown; verified_at?: string }>(
    "/v1/gaia-x/compliance/rerun",
  );

// ---------------------------------------------------------------------------
// Gaia-X Wizard — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchWizardState = () =>
  get<WizardState>("/v1/gaia-x/wizard");
export const generateWizardKeys = () =>
  post<{ private_key_pem: string }>("/v1/gaia-x/wizard/keys");
export const validateCertificate = (certChainPem: string, domain: string) =>
  post<{ cert_count: number }>("/v1/gaia-x/wizard/certificate", {
    cert_chain_pem: certChainPem,
    domain,
  });
export const requestLrn = (lrnType: string, lrnValue: string) =>
  post<void>("/v1/gaia-x/wizard/lrn", {
    lrn_type: lrnType,
    lrn_value: lrnValue,
  });
export const signLegalParticipant = (
  legalName: string,
  countryCode: string,
  privateKeyPem: string,
) =>
  post<void>("/v1/gaia-x/wizard/legal-participant", {
    legal_name: legalName,
    country_code: countryCode,
    private_key_pem: privateKeyPem,
  });
export const signTerms = (privateKeyPem: string) =>
  post<void>("/v1/gaia-x/wizard/terms", { private_key_pem: privateKeyPem });
export const submitGxdch = () =>
  post<void>("/v1/gaia-x/wizard/submit");

// ---------------------------------------------------------------------------
// Gaia-X Wallet — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchWalletStatus = () =>
  get<WalletStatus>("/v1/gaia-x/wallet");
export const initWalletSession = () =>
  post<WalletSession>("/v1/gaia-x/wallet/vc-init");
export const walletVerifyStatus = (sessionId: string) =>
  get<{ status: string }>(`/v1/gaia-x/wallet/vc-status/${encodeURIComponent(sessionId)}`);
export const saveWalletConnection = (sessionId: string) =>
  post<void>("/v1/gaia-x/wallet/vc-connect", { session_id: sessionId });
export const disconnectWallet = () => del("/v1/gaia-x/wallet");

// ---------------------------------------------------------------------------
// OID4VCI Credential Export — not in OpenAPI
// ---------------------------------------------------------------------------

export const createCredentialOffer = () =>
  post<{ offer_url: string }>("/v1/gaia-x/credentials/offer");

// ---------------------------------------------------------------------------
// Admin — not in OpenAPI
// ---------------------------------------------------------------------------

export const fetchAdminOrgs = () => get<OrgEntry[]>("/v1/admin/organizations");
export const fetchAdminInvites = () =>
  get<AdminInvite[]>("/v1/admin/invites");
export const createAdminInvite = (orgName: string) =>
  post<AdminInviteResult>("/v1/admin/invites", { org_name: orgName });
export const revokeAdminInvite = (token: string) =>
  del(`/v1/admin/invites/${encodeURIComponent(token)}`);
