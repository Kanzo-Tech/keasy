import createFetchClient, { type Middleware } from "openapi-fetch";
import type { Readable, Writable, components, paths } from "./schema";

export type { components, paths };

type Components = components["schemas"];
/** Every schema as the server sends it: write-only fields are absent. */
export type Schemas = { [K in keyof Components]: Readable<Components[K]> };
/** Every schema as a request body carries it: read-only fields are absent. */
export type Inputs = { [K in keyof Components]: Writable<Components[K]> };
export type ErrorCode = Schemas["ErrorCode"];
export type ErrorBody = Schemas["ErrorBody"];

/** A refusal, as the server's `ErrorBody` states it: `message` is its `detail`. */
export class ApiError extends Error {
  readonly code: ErrorCode | "unknown";
  readonly title: string;
  readonly data: ErrorBody["data"];

  constructor(body: Pick<ErrorBody, "title" | "detail" | "data"> & { code: ErrorCode | "unknown" }, readonly status?: number) {
    super(body.detail);
    this.name = "ApiError";
    this.code = body.code;
    this.title = body.title;
    this.data = body.data;
  }
}

/** Read the `ErrorBody` a non-2xx response carries. */
export async function apiError(response: Response): Promise<ApiError> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as ErrorBody | null;
  return new ApiError(
    body ?? {
      code: "unknown",
      title: "The request failed",
      detail: `Request failed (${response.status})`,
      data: {},
    },
    response.status,
  );
}

const errors: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) throw await apiError(response);
  },
};

/**
 * A typed client for the keasy API. Every non-2xx throws an {@link ApiError};
 * the host injects `fetch` to attach its own credentials.
 */
export function createApiClient(options: { baseUrl: string; fetch?: typeof fetch }) {
  const client = createFetchClient<paths>(options);
  client.use(errors);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
