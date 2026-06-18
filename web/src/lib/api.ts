import client, { ApiError, unwrap } from "./api/client";
import type { Schemas } from "./api/client";
import { fetchSSE } from "./api/sse";
import type { ProviderSchema } from "./types";

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

    /// Browser-driven completion (PATCH): after running the mapping in the
    /// browser and uploading the output by signed PUT, report the outcome —
    /// `status` + the executor's `RunStatus` `manifest` (or `error`).
    complete: async (id: string, req: Schemas["CompleteJobRequest"]) =>
      unwrap(await client.PATCH("/v1/jobs/{id}", { params: { path: { id } }, body: req })),

    /// The job's connection ref-map (`name → baseUrl`) — the browser executor
    /// feeds it to `sources()`/`run()` to resolve `@conn` aliases. No creds.
    sourceRefs: async (id: string): Promise<Record<string, string>> =>
      (unwrap(await client.GET("/v1/jobs/{id}/source-refs", { params: { path: { id } } }))).refs,

    /// Sign GET URLs so the browser fetches the program's cloud sources directly
    /// (signed GET for cloud, verbatim for public/HTTP). Returns `uri → fetchUrl`.
    signSourceUrls: async (id: string, uris: string[]): Promise<Record<string, string>> =>
      (unwrap(await client.POST("/v1/jobs/{id}/sources/urls", { params: { path: { id } }, body: { uris } }))).urls,

    /// Sign PUT URLs so the browser uploads the GraphAr output it produced
    /// directly to owner storage. Returns `outputKey → putUrl`.
    signOutputUrls: async (id: string, paths: string[]): Promise<Record<string, string>> =>
      (unwrap(await client.POST("/v1/jobs/{id}/output/urls", { params: { path: { id } }, body: { paths } }))).files,

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }));
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

  // (refs + providers moved client-side — `@fossil-lang/wasm` via
  // `lib/fossil/lineage.ts`. keasy no longer subprocesses the `fossil` binary
  // for lineage/providers; host-boundary, no /v1/refs · /v1/providers.)

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
    askStream: (
      id: string,
      question: string,
      opts?: { conversationId?: string; provider?: string; schema?: string; explain?: boolean },
    ) =>
      fetchSSE(`/v1/jobs/${id}/discover/ask-stream`, {
        question,
        conversation_id: opts?.conversationId,
        ...(opts?.provider ? { provider: opts.provider } : {}),
        ...(opts?.schema ? { schema: opts.schema } : {}),
        ...(opts?.explain ? { explain: opts.explain } : {}),
      }),
  },

  // ── Catalog (governance) ──────────────────────────────────────────────
  catalog: {
    datasets: async () =>
      (unwrap(await client.GET("/v1/catalog/datasets"))).datasets,
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
    schema: async (): Promise<ProviderSchema[]> =>
      unwrap(await client.GET("/v1/settings/schema")),

    org: async () => {
      const result = await client.GET("/v1/settings/organization");
      if (result.data === undefined) return null;
      return result.data;
    },

    preferences: async () =>
      unwrap(await client.GET("/v1/settings/preferences")),

    savePreferences: async (prefs: Schemas["Preferences"]) =>
      unwrap(await client.PUT("/v1/settings/preferences", { body: prefs })),

    catalogStorage: async (): Promise<{ cloud_account_id: string; base_url: string } | null> => {
      const res = await fetch("/v1/settings/catalog-storage", { credentials: "same-origin" });
      if (res.status === 204 || !res.ok) return null;
      const json = await res.json();
      return json?.data ?? json;
    },

    saveCatalogStorage: async (data: { cloud_account_id: string; base_url: string }) => {
      const res = await fetch("/v1/settings/catalog-storage", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(body?.error ?? "unknown", body?.message ?? "Failed to save");
      }
      const json = await res.json();
      return json?.data ?? json;
    },
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
  },

  // ── Org ────────────────────────────────────────────────────────────────
  org: {
    identity: async () =>
      unwrap(await client.GET("/v1/org/identity")),

    saveIdentity: async (data: Schemas["UpdateOrgIdentityPayload"]) =>
      unwrap(await client.PUT("/v1/org/identity", { body: data })),

    users: async () =>
      unwrap(await client.GET("/v1/org/users")),

    removeUser: async (id: string) => {
      unwrap(await client.DELETE("/v1/org/users/{id}", { params: { path: { id } } }));
    },

    inviteMember: async (email: string) =>
      unwrap(await client.POST("/v1/org/invites", { body: { email } })),
  },

  // ── Status ────────────────────────────────────────────────────────────
  status: {
    services: async () =>
      unwrap(await client.GET("/v1/status")),
  },

  // ── Assistant (SSE streaming) ───────────────────────────────────────────
  assistant: {
    suggestStream: (req: Schemas["SuggestRequest"]) =>
      fetchSSE("/v1/assistant/suggest-stream", req),

    generateStream: (req: Schemas["GenerateRequest"]) =>
      fetchSSE("/v1/assistant/generate-stream", req),
  },

};
