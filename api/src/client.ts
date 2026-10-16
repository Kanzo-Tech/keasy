import { Problem, type ProblemBody, type ProblemCode, isProblem } from "@kanzo-tech/kernel";
import createFetchClient, { type Middleware } from "openapi-fetch";
import type { Readable, Writable, components, paths } from "./schema";

export type { components, paths };

type Components = components["schemas"];
/** Every schema as the server sends it: write-only fields are absent. */
export type Schemas = { [K in keyof Components]: Readable<Components[K]> };
/** Every schema as a request body carries it: read-only fields are absent. */
export type Inputs = { [K in keyof Components]: Writable<Components[K]> };

/**
 * Every code a refusal carries: the server's own (`server/problems.bnf`), or the kernel's registry,
 * under which the forwarder in front of it (`@kanzo-tech/auth`) refuses — `api/unreachable` when the
 * server did not answer at all.
 */
export type RefusalCode = Schemas["ServerCode"] | ProblemCode;

/**
 * A non-2xx answer that names no code — a refusal the forwarder gives none (a cross-site request, a
 * path under no mount), a proxy's page: its status, and its own words. Whoever shows it codes it.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Whether asking again may get another answer, by what HTTP says and nothing else, as the AWS SDKs'
 * and gRPC's retry policies decide it: no answer at all (a network failure, a deadline), 408, 429 and
 * any 5xx — the forwarder's `api/unreachable` among them — and never another 4xx, coded or not. A 4xx
 * is a refusal or a misconfiguration, and the same request meets it again.
 */
export function retryable(err: unknown): boolean {
  const status = isProblem(err) || err instanceof HttpError ? (err as { status?: number }).status : undefined;
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Read the problem (`application/problem+json`) a non-2xx response carries — the server's, or the
 * forwarder's — through the kernel's one parser, at the response's own status; or, where it names
 * no code, an {@link HttpError}.
 */
export async function apiError(response: Response): Promise<Problem | HttpError> {
  const text = await response.clone().text();
  let body: ProblemBody | null = null;
  try {
    const parsed = JSON.parse(text) as Partial<ProblemBody> | null;
    if (parsed && typeof parsed.code === "string") body = parsed as ProblemBody;
  } catch {
    // Not JSON: neither the server nor the forwarder answered with a code, and its words are the message.
  }
  if (body) return Problem.from({ ...body, status: response.status });
  return new HttpError(text.trim().slice(0, 300) || `${response.status} ${response.statusText}`.trim(), response.status);
}

const errors: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) throw await apiError(response);
  },
};

/**
 * A typed client for the keasy API. Every non-2xx throws a kernel `Problem` (or an {@link HttpError});
 * the host injects `fetch` to attach its own credentials.
 */
export function createApiClient(options: { baseUrl: string; fetch?: typeof fetch }) {
  const client = createFetchClient<paths>(options);
  client.use(errors);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
