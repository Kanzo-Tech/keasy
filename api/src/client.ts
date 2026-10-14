import type { AuthErrorCode } from "@kanzo-tech/auth";
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
 * Who names a refusal: the server, in an `ErrorBody`, or the forwarder in front of it
 * (`@kanzo-tech/auth`), in a problem under its own code — `api/unreachable` when the server did not
 * answer at all.
 */
export type RefusalCode = ErrorCode | AuthErrorCode;

/** A refusal, as the server's `ErrorBody` or the forwarder's problem states it: `message` is its `detail`. */
export class ApiError extends Error {
  readonly code: RefusalCode;
  readonly title: string;
  readonly data: ErrorBody["data"];

  constructor(
    body: Pick<ErrorBody, "title" | "detail" | "data"> & { code: RefusalCode },
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

/**
 * Read the `ErrorBody` a non-2xx response carries — the server's, or the forwarder's problem, the same
 * members under its own code. An answer that names no code is a plain `Error` in its own words: no
 * code was given, so whoever shows it codes it.
 */
export async function apiError(response: Response): Promise<Error> {
  const text = await response.clone().text();
  let body: ErrorBody | null = null;
  try {
    const parsed = JSON.parse(text) as Partial<ErrorBody> | null;
    if (parsed && typeof parsed.code === "string") body = parsed as ErrorBody;
  } catch {
    // Not JSON: neither the server nor the forwarder answered with a code, and its words are the message.
  }
  if (body) return new ApiError(body, response.status);
  return new Error(text.trim().slice(0, 300) || `${response.status} ${response.statusText}`.trim());
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
