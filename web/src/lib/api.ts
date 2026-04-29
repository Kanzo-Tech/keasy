import client, { ApiError, unwrap } from "./api/client";
import type { Schemas } from "./api/client";
import { fetchSSEJson } from "./api/sse";
import type {
  ProviderInfo,
  ComplyEvent,
  FossilAnalysis,
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

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }));
    },

    catalog: async (id: string): Promise<string> => {
      const res = await fetch(`/v1/jobs/${id}/catalog`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Failed to fetch catalog");
      return res.text();
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

  // ── Connections (backend: /v1/connectors) ─────────────────────────────
  connections: {
    list: async (direction?: string) =>
      unwrap(await client.GET("/v1/connectors", {
        params: { query: direction ? { direction } : {} },
      })),

    get: async (id: string) =>
      unwrap(await client.GET("/v1/connectors/{id}", { params: { path: { id } } })),

    create: async (req: Schemas["CreateConnectorRequest"]) =>
      unwrap(await client.POST("/v1/connectors", { body: req })),

    update: async (id: string, req: Schemas["UpdateConnectorRequest"]) =>
      unwrap(await client.PUT("/v1/connectors/{id}", { params: { path: { id } }, body: req })),

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/connectors/{id}", { params: { path: { id } } }));
    },

    kinds: async () =>
      unwrap(await client.GET("/v1/connectors/kinds")),

    testConfig: async (config: Schemas["ConnectorConfig"]) => {
      unwrap(await client.POST("/v1/connectors/test", { body: { config } }));
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────
  settings: {
    // TODO: add ProviderInfo to openapi spec
    providers: async () =>
      unwrap(await client.GET("/v1/providers")) as unknown as ProviderInfo[],

    org: async () => {
      const result = await client.GET("/v1/settings/organization");
      if (result.data === undefined) return null;
      return result.data;
    },

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
      unwrap(await client.POST("/v1/auth/logout")),

    inviteInfo: async (token: string) =>
      unwrap(await client.GET("/v1/auth/invite-info", {
        params: { query: { token } },
      })),
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
      unwrap(await client.GET("/v1/org/invites")),

    createInvite: async (role: string) =>
      unwrap(await client.POST("/v1/org/invites", { body: { role } })),

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

    complyStream: (certChainPem?: string) =>
      fetchSSEJson<ComplyEvent>("/v1/gaia-x/comply", {
        cert_chain_pem: certChainPem ?? null,
      }),

  },

  // ── Admin ─────────────────────────────────────────────────────────────
  admin: {
    orgs: async () =>
      unwrap(await client.GET("/v1/admin/organizations")),

    invites: async () =>
      unwrap(await client.GET("/v1/admin/invites")),

    createInvite: async (orgName: string) =>
      unwrap(await client.POST("/v1/admin/invites", { body: { org_name: orgName } })),

    revokeInvite: async (token: string) => {
      unwrap(await client.DELETE("/v1/admin/invites/{token}", {
        params: { path: { token } },
      }));
    },

  },

  // ── Status ────────────────────────────────────────────────────────────
  status: {
    services: async () =>
      unwrap(await client.GET("/v1/status")),
  },

  // ── Scripts ───────────────────────────────────────────────────────────
  scripts: {
    validate: async (script: string) =>
      unwrap(await client.POST("/v1/scripts/validate", { body: { script } })),
  },

  // ── Fossil Analysis ────────────────────────────────────────────────────
  fossil: {
    analyze: async (
      script: string,
      cursorOffset: number,
    ): Promise<FossilAnalysis> => {
      try {
        const res = unwrap(
          await client.POST("/v1/fossil/analyze", {
            body: { script, cursor_offset: cursorOffset },
          }),
        );
        return res as unknown as FossilAnalysis;
      } catch {
        return { completions: [], diagnostics: [] };
      }
    },
  },

};
