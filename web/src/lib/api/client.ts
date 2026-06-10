import createClient, { type Middleware } from "openapi-fetch";
import type { paths, components } from "./schema";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const envelopeMiddleware: Middleware = {
  async onResponse({ response }) {
    if (!response.ok) {
      const body = await response.clone().json().catch(() => null);
      const code =
        (typeof body?.error === "string" ? body.error : body?.error?.code) ??
        "unknown";
      const message =
        (typeof body?.error === "string"
          ? body?.message
          : body?.error?.message) ?? `Request failed (${response.status})`;
      throw new ApiError(code, message);
    }

    if (response.status === 204) {
      return undefined;
    }

    // Unwrap { "data": ... } envelope
    const json = await response.clone().json().catch(() => null);
    if (json === null) return undefined;
    const unwrapped = json?.data !== undefined ? json.data : json;
    return new Response(JSON.stringify(unwrapped), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};

const client = createClient<paths>({ baseUrl: "/" });
client.use(envelopeMiddleware);

export default client;
export type { paths, components };
export type Schemas = components["schemas"];

export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined) {
    throw result.error instanceof Error
      ? result.error
      : new ApiError("unknown", String(result.error));
  }
  return result.data as T;
}
