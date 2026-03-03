import client, { ApiError, unwrap } from "./api/client";
import type { Schemas } from "./api/client";
import type {
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
  OrgInvite,
  AdminInvite,
  AdminInviteResult,
  CreateOrgInviteResponse,
  CatalogResponse,
} from "./types";

export { ApiError };
export type { ServiceStatus } from "./types";

export const api = {
  // ── Jobs ──────────────────────────────────────────────────────────────
  jobs: {
    list: async () =>
      unwrap(await client.GET("/v1/jobs")),

    get: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}", { params: { path: { id } } })),

    create: async (req: Schemas["CreateJobRequest"]) =>
      unwrap(await client.POST("/v1/jobs", { body: req })),

    update: async (id: string, req: Schemas["UpdateJobRequest"]) =>
      unwrap(await client.PUT("/v1/jobs/{id}", { params: { path: { id } }, body: req })),

    cancel: async (id: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/cancel", { params: { path: { id } } })),

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }));
    },

    graph: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/graph", { params: { path: { id } } })) as GraphData,

    unifiedGraph: async () =>
      unwrap(await client.GET("/v1/graph")) as GraphData,

    adminGraph: async (orgId?: string) =>
      unwrap(await client.GET("/v1/graph", {
        params: { query: orgId ? { org_id: orgId } : {} },
      })) as GraphData,

    catalog: async (id: string, format: string): Promise<string> => {
      const data = unwrap(
        await client.GET("/v1/jobs/{id}/catalog", {
          params: { path: { id }, query: { format } },
        }),
      ) as CatalogResponse;
      return data.catalog;
    },

    dashboardLayout: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/dashboard-layout", {
        params: { path: { id } },
      })) as unknown as Record<string, unknown> | undefined,

    saveDashboardLayout: async (id: string, layout: unknown) => {
      unwrap(await client.PUT("/v1/jobs/{id}/dashboard-layout", {
        params: { path: { id } },
        body: layout,
      }));
    },
  },

  // ── Connections ────────────────────────────────────────────────────────
  connections: {
    list: async (type?: string) =>
      unwrap(await client.GET("/v1/connections", {
        params: { query: type ? { type } : {} },
      })),

    get: async (id: string) =>
      unwrap(await client.GET("/v1/connections/{id}", { params: { path: { id } } })),

    create: async (req: Schemas["CreateConnectionRequest"]) =>
      unwrap(await client.POST("/v1/connections", { body: req })),

    update: async (id: string, req: Schemas["UpdateConnectionRequest"]) =>
      unwrap(await client.PUT("/v1/connections/{id}", {
        params: { path: { id } },
        body: req,
      })),

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/connections/{id}", { params: { path: { id } } }));
    },

    files: async (id: string) =>
      unwrap(await client.GET("/v1/connections/{id}/files", {
        params: { path: { id } },
      })) as FileEntry[],
  },

  // ── Cloud Accounts ────────────────────────────────────────────────────
  cloud: {
    list: async () =>
      unwrap(await client.GET("/v1/cloud-accounts")),

    get: async (id: string) =>
      unwrap(await client.GET("/v1/cloud-accounts/{id}", { params: { path: { id } } })),

    create: async (req: Schemas["CreateCloudAccountRequest"]) =>
      unwrap(await client.POST("/v1/cloud-accounts", { body: req })),

    update: async (id: string, req: Schemas["UpdateCloudAccountRequest"]) =>
      unwrap(await client.PUT("/v1/cloud-accounts/{id}", {
        params: { path: { id } },
        body: req,
      })),

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/cloud-accounts/{id}", { params: { path: { id } } }));
    },
  },

  // ── Discovery ─────────────────────────────────────────────────────────
  discovery: {
    load: async (id: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/discover/load", { params: { path: { id } } })),

    chart: async (id: string, request: Schemas["ChartRequest"]) =>
      unwrap(await client.POST("/v1/jobs/{id}/discover/chart", {
        params: { path: { id } },
        body: request,
      })) as TabularData,

    ask: async (id: string, question: string, conversationId?: string, provider?: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/discover/ask", {
        params: { path: { id } },
        body: {
          question,
          conversation_id: conversationId,
          ...(provider ? { provider } : {}),
        },
      })) as AskResponse,

    search: async (query: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/search", {
        body: { query, job_id: jobId },
      })) as SearchResult[],

    expand: async (nodeId: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/expand", {
        body: { node_id: nodeId, job_id: jobId },
      })) as GraphData,
  },

  // ── Conversations ─────────────────────────────────────────────────────
  conversations: {
    create: async (id: string, title?: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/conversations", {
        params: { path: { id } },
        body: { title },
      })) as Conversation,

    list: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/conversations", {
        params: { path: { id } },
      })) as Conversation[],

    messages: async (id: string) =>
      unwrap(await client.GET("/v1/conversations/{id}/messages", {
        params: { path: { id } },
      })) as ConversationMessage[],

    rename: async (id: string, title: string) => {
      unwrap(await client.PUT("/v1/conversations/{id}", {
        params: { path: { id } },
        body: { title },
      }));
    },

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/conversations/{id}", {
        params: { path: { id } },
      }));
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────
  settings: {
    schema: async () =>
      unwrap(await client.GET("/v1/settings/schema")) as unknown as ProviderSchema[],

    providers: async () =>
      unwrap(await client.GET("/v1/providers")) as unknown as ProviderInfo[],

    org: async () => {
      const result = await client.GET("/v1/settings/organization");
      if (result.data === undefined) return null;
      return result.data as Schemas["OrgSettings"];
    },

    saveOrg: async (settings: Schemas["OrgSettings"]) =>
      unwrap(await client.PUT("/v1/settings/organization", { body: settings })),

    preferences: async () =>
      unwrap(await client.GET("/v1/settings/preferences")),

    savePreferences: async (prefs: Schemas["Preferences"]) =>
      unwrap(await client.PUT("/v1/settings/preferences", { body: prefs })),
  },

  // ── AI Providers ──────────────────────────────────────────────────────
  ai: {
    providers: async () =>
      unwrap(await client.GET("/v1/settings/ai/providers")),

    saveProvider: async (
      providerId: string,
      config: { api_key: string; model?: string; max_tokens?: number },
    ) =>
      unwrap(await client.PUT("/v1/settings/ai/providers/{provider_id}", {
        params: { path: { provider_id: providerId } },
        body: { ...config, provider: providerId },
      })),

    removeProvider: async (providerId: string) => {
      unwrap(await client.DELETE("/v1/settings/ai/providers/{provider_id}", {
        params: { path: { provider_id: providerId } },
      }));
    },
  },

  // ── Auth ───────────────────────────────────────────────────────────────
  auth: {
    me: async () =>
      unwrap(await client.GET("/v1/auth/me")),

    workspaces: async () =>
      unwrap(await client.GET("/v1/auth/workspaces")),

    logout: async () =>
      unwrap(await client.POST("/v1/auth/logout")) as Schemas["LogoutResponse"],

    inviteInfo: async (token: string) =>
      unwrap(await client.GET("/v1/auth/invite-info", {
        params: { query: { token } },
      })) as Schemas["InviteInfoResponse"],
  },

  // ── Org ────────────────────────────────────────────────────────────────
  org: {
    identity: async () =>
      unwrap(await client.GET("/v1/org/identity")),

    saveIdentity: async (data: Schemas["UpdateOrgIdentityPayload"]) =>
      unwrap(await client.PUT("/v1/org/identity", { body: data })),

    users: async () =>
      unwrap(await client.GET("/v1/org/users")),

    updateRole: async (id: string, role: string) => {
      unwrap(await client.PUT("/v1/org/users/{id}", {
        params: { path: { id } },
        body: { role },
      }));
    },

    removeUser: async (id: string) => {
      unwrap(await client.DELETE("/v1/org/users/{id}", { params: { path: { id } } }));
    },

    invites: async () =>
      unwrap(await client.GET("/v1/org/invites")) as OrgInvite[],

    createInvite: async (role: string) =>
      unwrap(await client.POST("/v1/org/invites", { body: { role } })) as CreateOrgInviteResponse,

    revokeInvite: async (token: string) => {
      unwrap(await client.DELETE("/v1/org/invites/{token}", {
        params: { path: { token } },
      }));
    },
  },

  // ── Gaia-X ────────────────────────────────────────────────────────────
  gaiax: {
    compliance: {
      status: async () =>
        unwrap(await client.GET("/v1/gaia-x/compliance")),
    },

    comply: async (certChainPem?: string) =>
      unwrap(await client.POST("/v1/gaia-x/comply", {
        body: { cert_chain_pem: certChainPem ?? null },
      })) as Schemas["ComplyResponse"],

  },

  // ── Admin ─────────────────────────────────────────────────────────────
  admin: {
    orgs: async () =>
      unwrap(await client.GET("/v1/admin/organizations")),

    invites: async () =>
      unwrap(await client.GET("/v1/admin/invites")) as AdminInvite[],

    createInvite: async (orgName: string) =>
      unwrap(await client.POST("/v1/admin/invites", { body: { org_name: orgName } })) as AdminInviteResult,

    revokeInvite: async (token: string) => {
      unwrap(await client.DELETE("/v1/admin/invites/{token}", {
        params: { path: { token } },
      }));
    },
  },

  // ── Status ────────────────────────────────────────────────────────────
  status: {
    services: async () =>
      unwrap(await client.GET("/v1/status")) as Schemas["ServiceStatusResponse"],
  },

  // ── Scripts ───────────────────────────────────────────────────────────
  scripts: {
    validate: async (script: string) =>
      unwrap(await client.POST("/v1/scripts/validate", { body: { script } })),
  },

  // ── Validation ────────────────────────────────────────────────────────
  validation: {
    validate: async (dataUrl: string, sourceId: string, shapePath: string) =>
      unwrap(await client.POST("/v1/validate", {
        body: {
          data_url: dataUrl,
          connection_id: sourceId,
          shape_path: shapePath,
        },
      })) as ShapeValidationResult,
  },
};
