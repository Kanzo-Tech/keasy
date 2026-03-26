import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError } from "./client";

/**
 * Parse SSE frames from a fetch Response, yielding `{ event, data }` for each.
 *
 * Uses eventsource-parser (WHATWG-compliant) for robust multi-line,
 * chunked-boundary, and edge-case handling.
 */
export async function* fetchSSE(
  url: string,
  body?: unknown,
): AsyncGenerator<{ event: string; data: string }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let text: Record<string, unknown> | null = null;
    try {
      text = JSON.parse(raw);
    } catch {
      /* not JSON */
    }
    const msg =
      text?.error &&
      typeof text.error === "object" &&
      (text.error as Record<string, unknown>).message
        ? String((text.error as Record<string, unknown>).message)
        : text?.message
          ? String(text.message)
          : raw || `Request failed (${res.status})`;
    const code =
      text?.error && typeof text.error === "object"
        ? String(
            (text.error as Record<string, unknown>).code ?? "request_error",
          )
        : "request_error";
    throw new ApiError(code, msg);
  }

  if (!res.body) return;

  const reader = res.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.data) {
        yield { event: value.event ?? "message", data: value.data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Convenience wrapper: yields parsed JSON payloads from an SSE stream.
 */
export async function* fetchSSEJson<T>(
  url: string,
  body?: unknown,
): AsyncGenerator<T> {
  for await (const { data } of fetchSSE(url, body)) {
    yield JSON.parse(data) as T;
  }
}
