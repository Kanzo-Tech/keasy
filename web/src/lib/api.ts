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
  MeResponse,
  WorkspacesResponse,
  WizardState,
  ComplianceStatus,
  WalletStatus,
  WalletSession,
  AdminInvite,
  AdminInviteResult,
} from "./types";

export { ApiError };

export interface ServiceStatus {
  wallet: boolean;
  issuer: boolean;
  oidc: boolean;
  gxdch_notary: boolean;
  gxdch_compliance: boolean;
  base_domain: string | null;
}

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
      unwrap(await client.GET("/v1/jobs/{id}/graph", { params: { path: { id } } })) as unknown as GraphData,

    unifiedGraph: async () =>
      unwrap(await client.GET("/v1/graph")) as unknown as GraphData,

    adminGraph: async (orgId?: string) =>
      unwrap(await client.GET("/v1/graph", {
        params: { query: orgId ? { org_id: orgId } : {} },
      })) as unknown as GraphData,

    catalog: async (id: string, format: string): Promise<string> => {
      const data = unwrap(
        await client.GET("/v1/jobs/{id}/catalog", {
          params: { path: { id }, query: { format } },
        }),
      ) as unknown as { catalog: string };
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
      })) as unknown as FileEntry[],
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
      })) as unknown as TabularData,

    ask: async (id: string, question: string, conversationId?: string, provider?: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/discover/ask", {
        params: { path: { id } },
        body: {
          question,
          conversation_id: conversationId,
          ...(provider ? { provider } : {}),
        },
      })) as unknown as AskResponse,

    search: async (query: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/search", {
        body: { query, job_id: jobId },
      })) as unknown as SearchResult[],

    expand: async (nodeId: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/expand", {
        body: { node_id: nodeId, job_id: jobId },
      })) as unknown as GraphData,
  },

  // ── Conversations ─────────────────────────────────────────────────────
  conversations: {
    create: async (id: string, title?: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/conversations", {
        params: { path: { id } },
        body: { title },
      })) as unknown as Conversation,

    list: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/conversations", {
        params: { path: { id } },
      })) as unknown as Conversation[],

    messages: async (id: string) =>
      unwrap(await client.GET("/v1/conversations/{id}/messages", {
        params: { path: { id } },
      })) as unknown as ConversationMessage[],

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
      unwrap(await client.GET("/v1/auth/me")) as unknown as MeResponse,

    workspaces: async () =>
      unwrap(await client.GET("/v1/auth/workspaces")) as unknown as WorkspacesResponse,

    logout: async () =>
      unwrap(await client.POST("/v1/auth/logout")) as unknown as { end_session_url?: string },

    inviteInfo: async (token: string) =>
      unwrap(await client.GET("/v1/auth/invite-info", {
        params: { query: { token } },
      })) as unknown as { valid: boolean },
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
      unwrap(await client.GET("/v1/org/invites")) as unknown as OrgInvite[],

    createInvite: async (role: string) =>
      unwrap(await client.POST("/v1/org/invites", { body: { role } })) as unknown as { token: string; invite_url: string },

    revokeInvite: async (token: string) => {
      unwrap(await client.DELETE("/v1/org/invites/{token}", {
        params: { path: { token } },
      }));
    },
  },

  // ── Gaia-X ────────────────────────────────────────────────────────────
  gaiax: {
    wizard: {
      state: async () =>
        unwrap(await client.GET("/v1/gaia-x/wizard")) as unknown as WizardState,

      generateKeys: async () =>
        unwrap(await client.POST("/v1/gaia-x/wizard/keys")) as unknown as { private_key_pem: string },

      validateCert: async (certChainPem: string, domain: string) =>
        unwrap(await client.POST("/v1/gaia-x/wizard/certificate", {
          body: { cert_chain_pem: certChainPem, domain },
        })) as unknown as { cert_count: number },

      requestLrn: async (lrnType: string, lrnValue: string) => {
        unwrap(await client.POST("/v1/gaia-x/wizard/lrn", {
          body: { lrn_type: lrnType, lrn_value: lrnValue },
        }));
      },

      signLp: async (legalName: string, countryCode: string, privateKeyPem: string) => {
        unwrap(await client.POST("/v1/gaia-x/wizard/legal-participant", {
          body: {
            legal_name: legalName,
            country_code: countryCode,
            private_key_pem: privateKeyPem,
          },
        }));
      },

      signTerms: async (privateKeyPem: string) => {
        unwrap(await client.POST("/v1/gaia-x/wizard/terms", {
          body: { private_key_pem: privateKeyPem },
        }));
      },

      submit: async () => {
        unwrap(await client.POST("/v1/gaia-x/wizard/submit"));
      },
    },

    compliance: {
      status: async () =>
        unwrap(await client.GET("/v1/gaia-x/compliance")) as unknown as ComplianceStatus,

      rerun: async () =>
        unwrap(await client.POST("/v1/gaia-x/compliance/rerun")) as unknown as { compliant: boolean; compliance_vc?: unknown; verified_at?: string },
    },

    wallet: {
      status: async () =>
        unwrap(await client.GET("/v1/gaia-x/wallet")) as unknown as WalletStatus,

      init: async () =>
        unwrap(await client.POST("/v1/gaia-x/wallet/vc-init")) as unknown as WalletSession,

      verifyStatus: async (sessionId: string) =>
        unwrap(await client.GET("/v1/gaia-x/wallet/vc-status/{session_id}", {
          params: { path: { session_id: sessionId } },
        })) as unknown as { status: string },

      connect: async (sessionId: string) => {
        unwrap(await client.POST("/v1/gaia-x/wallet/vc-connect", {
          body: { session_id: sessionId },
        }));
      },

      disconnect: async () => {
        unwrap(await client.DELETE("/v1/gaia-x/wallet"));
      },
    },

    credentials: {
      offer: async () =>
        unwrap(await client.POST("/v1/gaia-x/credentials/offer")) as unknown as { offer_url: string },
    },
  },

  // ── Admin ─────────────────────────────────────────────────────────────
  admin: {
    orgs: async () =>
      unwrap(await client.GET("/v1/admin/organizations")),

    invites: async () =>
      unwrap(await client.GET("/v1/admin/invites")) as unknown as AdminInvite[],

    createInvite: async (orgName: string) =>
      unwrap(await client.POST("/v1/admin/invites", { body: { org_name: orgName } })) as unknown as AdminInviteResult,

    revokeInvite: async (token: string) => {
      unwrap(await client.DELETE("/v1/admin/invites/{token}", {
        params: { path: { token } },
      }));
    },
  },

  // ── Status ────────────────────────────────────────────────────────────
  status: {
    services: async () =>
      unwrap(await client.GET("/v1/status")) as unknown as ServiceStatus,
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
      })) as unknown as ShapeValidationResult,
  },
};
