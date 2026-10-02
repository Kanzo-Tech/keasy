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

/**
 * What answered when the server did not: the BFF in front of it, a proxy, or Next's own 500 with the
 * API down. The server itself always answers an `ErrorBody`.
 */
export type NoBodyCode = "bff/failed";

/** A refusal, as the server's `ErrorBody` states it: `message` is its `detail`. */
export class ApiError extends Error {
  readonly code: ErrorCode | NoBodyCode;
  readonly title: string;
  readonly data: ErrorBody["data"];

  constructor(
    body: Pick<ErrorBody, "title" | "detail" | "data"> & { code: ErrorCode | NoBodyCode },
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(body.detail, options);
    this.name = "ApiError";
    this.code = body.code;
    this.title = body.title;
    this.data = body.data;
  }
}

/** Read the `ErrorBody` a non-2xx response carries, or say what answered instead. */
export async function apiError(response: Response): Promise<ApiError> {
  const text = await response.clone().text();
  let body: ErrorBody | null = null;
  try {
    const parsed = JSON.parse(text) as Partial<ErrorBody> | null;
    if (parsed && typeof parsed.code === "string") body = parsed as ErrorBody;
  } catch {
    // Not JSON: what answered was not the server, and its words become the detail below.
  }
  return new ApiError(
    body ?? {
      code: "bff/failed",
      title: "The request failed before it reached the server",
      detail: text.trim().slice(0, 300) || `${response.status} ${response.statusText}`.trim(),
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
