import { ApiError, http as client, type Schemas } from "./api/client";
import type { ProviderSchema } from "./types";

export { ApiError };

/**
 * The per-endpoint facade the pages still call. New code uses `http`/`$api`
 * from `lib/api/client` directly; this file goes once the last caller has.
 */
const unwrap = <T>(result: { data?: T }): T => result.data as T;

export const api = {
  // ── Jobs ──────────────────────────────────────────────────────────────
  jobs: {
    list: async () =>
      unwrap(await client.GET("/v1/jobs")),

    get: async (id: string) =>
      unwrap(await client.GET("/v1/jobs/{id}", { params: { path: { id } } })),
  },

  // (refs + providers moved client-side — `@fossil-lang/wasm` via
  // `lib/fossil/checker.ts`. keasy no longer subprocesses the `fossil` binary
  // for lineage/providers; host-boundary, no /v1/refs · /v1/providers.)

  // ── Connections ────────────────────────────────────────────────────────
  connections: {
    list: async (type?: Schemas["ConnectionKind"]) =>
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

    /// Source connection name → base URL: the map fossil expands `@name/…` against.
    refs: async (): Promise<Record<string, string>> =>
      (unwrap(await client.GET("/v1/connections/refs"))).refs,

    /// Locator → signed GET URL, for the locators the caller may read.
    signLocators: async (locators: string[]): Promise<Record<string, string>> =>
      (unwrap(await client.POST("/v1/connections/urls", { body: { locators } }))).urls,
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

  // ── Datasets (owner) ──────────────────────────────────────────────────
  datasets: {
    list: async () => unwrap(await client.GET("/v1/datasets")),
  },

  // ── Settings ──────────────────────────────────────────────────────────
  settings: {
    schema: async (): Promise<ProviderSchema[]> =>
      unwrap(await client.GET("/v1/settings/schema")),

    /// `null` until the owner has set it (204).
    catalogStorage: async () =>
      (await client.GET("/v1/settings/catalog-storage")).data ?? null,

    saveCatalogStorage: async (data: Schemas["CatalogStoragePayload"]) =>
      unwrap(await client.PUT("/v1/settings/catalog-storage", { body: data })),
  },

  // ── AI Providers ──────────────────────────────────────────────────────
  ai: {
    /// Every provider keasy can call, with the model it runs by default.
    catalog: async () =>
      unwrap(await client.GET("/v1/ai/providers")),

    providers: async () =>
      unwrap(await client.GET("/v1/settings/ai/providers")),

    saveProvider: async (providerId: string, config: Schemas["SaveAiProviderRequest"]) =>
      unwrap(await client.PUT("/v1/settings/ai/providers/{provider}", {
        params: { path: { provider: providerId as Schemas["AiProvider"] } },
        body: config,
      })),

    removeProvider: async (providerId: string) => {
      unwrap(await client.DELETE("/v1/settings/ai/providers/{provider}", {
        params: { path: { provider: providerId as Schemas["AiProvider"] } },
      }));
    },
  },

  // ── Auth ───────────────────────────────────────────────────────────────
  // Who you are and what you may do come from `useSession` — the BFF's own
  // session endpoint — so the only thing left here is the switcher's list, which
  // is a claim on the token rather than a property of the session.
  auth: {
    workspaces: async () =>
      unwrap(await client.GET("/v1/auth/workspaces")),
  },

};
