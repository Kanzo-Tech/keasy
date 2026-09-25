import { ApiError, http as client } from "./api/client";

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

};
