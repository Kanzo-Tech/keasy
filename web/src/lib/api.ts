import client, { ApiError, unwrap } from "./api/client";
import type { Schemas } from "./api/client";
import type {
  ProviderSchema,
  ProviderInfo,
  ComplyEvent,
  FossilAnalysis,
  JobEvent,
  TabularData,
} from "./types";

export { ApiError };
export type { ServiceStatus } from "./types";

export type FieldStatsItem = Schemas["FieldStats"];

async function* parseSseStream<T>(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop()!;
    for (const part of parts) {
      const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) yield JSON.parse(dataLine.slice(5).trim()) as T;
    }
  }
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

    stream: async function* (id: string, signal?: AbortSignal): AsyncGenerator<JobEvent> {
      const res = await fetch(`/v1/jobs/${id}/stream`, { credentials: "same-origin", signal });
      if (!res.ok) return;
      yield* parseSseStream<JobEvent>(res.body!.getReader());
    },

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }));
    },

    graph: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/graph", { params: { path: { id } } })),

    catalog: async (id: string, format: string): Promise<string> => {
      const data = unwrap(
        await client.GET("/v1/jobs/{id}/catalog", {
          params: { path: { id }, query: { format } },
        }),
      );
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

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/connections/{id}", { params: { path: { id } } }));
    },

    files: async (id: string) =>
      unwrap(await client.GET("/v1/connections/{id}/files", {
        params: { path: { id } },
      })),

    schema: async (id: string, path: string) =>
      unwrap(await client.GET("/v1/connections/{id}/schema", {
        params: { path: { id }, query: { path } },
      })),

    upload: async (id: string, path: string, content: string) => {
      await client.PUT("/v1/connections/{id}/files", {
        params: { path: { id } },
        body: { path, content },
      });
    },
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
      })) as TabularData, // Override: rows type differs from schema

    fieldStats: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/discover/field-stats", {
        params: { path: { id } },
      })) as FieldStatsItem[],

    ask: async (id: string, question: string, conversationId?: string, provider?: string) =>
      unwrap(await client.POST("/v1/jobs/{id}/discover/ask", {
        params: { path: { id } },
        body: {
          question,
          conversation_id: conversationId,
          ...(provider ? { provider } : {}),
        },
      })),

    search: async (query: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/search", {
        body: { query, job_id: jobId },
      })),

    expand: async (nodeId: string, jobId?: string) =>
      unwrap(await client.POST("/v1/graph/expand", {
        body: { node_id: nodeId, job_id: jobId },
      })),
  },

  // ── Conversations ─────────────────────────────────────────────────────
  conversations: {
    list: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}/conversations", {
        params: { path: { id } },
      })),

    messages: async (id: string) =>
      unwrap(await client.GET("/v1/conversations/{id}/messages", {
        params: { path: { id } },
      })),

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
    // TODO: add ProviderSchema to openapi spec
    schema: async () =>
      unwrap(await client.GET("/v1/settings/schema")) as unknown as ProviderSchema[],

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

    complyStream: async function* (certChainPem?: string): AsyncGenerator<ComplyEvent> {
      const res = await fetch("/v1/gaia-x/comply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ cert_chain_pem: certChainPem ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error?.message ?? body?.message ?? `Request failed (${res.status})`;
        throw new ApiError(String(body?.error?.code ?? "unknown"), msg);
      }
      yield* parseSseStream<ComplyEvent>(res.body!.getReader());
    },

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

  // ── Assistant ──────────────────────────────────────────────────────────
  assistant: {
    suggest: async (req: Schemas["SuggestRequest"]) =>
      unwrap(await client.POST("/v1/assistant/suggest", { body: req })),

    generate: async (req: Schemas["GenerateRequest"]) =>
      unwrap(await client.POST("/v1/assistant/generate", { body: req })),
  },

  // ── Scripts ───────────────────────────────────────────────────────────
  scripts: {
    validate: async (script: string) =>
      unwrap(await client.POST("/v1/scripts/validate", { body: { script } })),
  },

  // ── Fossil Analysis ────────────────────────────────────────────────────
  fossil: {
    analyze: async (script: string, cursorOffset: number) => {
      const res = await fetch("/v1/fossil/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ script, cursor_offset: cursorOffset }),
      });
      if (!res.ok) return { completions: [], diagnostics: [] } as FossilAnalysis;
      return (await res.json()) as FossilAnalysis;
    },
  },

  // ── Validation ────────────────────────────────────────────────────────
  validation: {
    validate: async (jobId: string, connectionId: string, shapePath: string) =>
      unwrap(await client.POST("/v1/validate", {
        body: {
          job_id: jobId,
          connection_id: connectionId,
          shape_path: shapePath,
        },
      })),
  },
};
