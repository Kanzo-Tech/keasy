import { ApiError, http as client, type Schemas } from "./api/client";

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

    create: async (req: Schemas["CreateJobRequest"]) =>
      unwrap(await client.POST("/v1/jobs", { body: req })),

    update: async (id: string, req: Schemas["UpdateJobRequest"]) =>
      unwrap(await client.PUT("/v1/jobs/{id}", { params: { path: { id } }, body: req })),

    /// Browser-driven completion (PATCH): after running the mapping in the
    /// browser and uploading the output by signed PUT, report the outcome —
    /// `status` + the executor's run report as `manifest` (opaque to keasy), or
    /// `error`.
    complete: async (id: string, req: Schemas["CompleteJobRequest"]) =>
      unwrap(await client.PATCH("/v1/jobs/{id}", { params: { path: { id } }, body: req })),

    /// Sign PUT URLs so the browser uploads the output it produced directly to
    /// owner storage. Returns `outputKey → putUrl`.
    signOutputUrls: async (id: string, paths: string[]): Promise<Record<string, string>> =>
      (unwrap(await client.POST("/v1/jobs/{id}/output/urls", { params: { path: { id } }, body: { paths } }))).files,

    /// Sign GET URLs for dataset-relative keys the CALLER enumerated — the
    /// reading twin of `signOutputUrls`. The list comes from the corpus reader;
    /// keasy signs what it is handed and derives nothing.
    signDatasetUrls: async (id: string, paths: string[]): Promise<Record<string, string>> =>
      (unwrap(await client.POST("/v1/jobs/{id}/discover/urls", { params: { path: { id } }, body: { paths } }))).files,

    /// Tell the host what the corpus holds: the relations fossil named and the
    /// files that carry them.
    publishRelations: async (id: string, relations: Schemas["OutputRelation"][]) =>
      unwrap(await client.PUT("/v1/jobs/{id}/relations", { params: { path: { id } }, body: { relations } })),

    remove: async (id: string) => {
      unwrap(await client.DELETE("/v1/jobs/{id}", { params: { path: { id } } }));
    },
  },

  // ── Datasets (owner) ──────────────────────────────────────────────────
  datasets: {
    list: async () => unwrap(await client.GET("/v1/datasets")),
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
