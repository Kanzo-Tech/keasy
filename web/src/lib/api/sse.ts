import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError } from "./client";

export interface SseFrame {
  event: string;
  data: string;
}

/** The `error` frame's payload — one shape, written by `server/src/ai/client.rs::error_event`. */
export interface SseFailure {
  code: string;
  message: string;
}

export function sseFailure(frame: SseFrame): SseFailure | null {
  return frame.event === "error" ? (JSON.parse(frame.data) as SseFailure) : null;
}

/**
 * The same frames with an `error` turned into a throw, so a caller that has no
 * use for the code reports it through `useAiStream`'s own failure path.
 */
export async function* failOnError(
  frames: AsyncGenerator<SseFrame>,
): AsyncGenerator<SseFrame> {
  for await (const frame of frames) {
    const failure = sseFailure(frame);
    if (failure) throw new ApiError(failure.code, failure.message);
    yield frame;
  }
}

/**
 * Parse SSE frames from a fetch Response, yielding `{ event, data }` for each.
 *
 * Uses eventsource-parser (WHATWG-compliant) for robust multi-line,
 * chunked-boundary, and edge-case handling.
 */
export async function* fetchSSE(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal,
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
    throw new ApiError(code, msg, res.status);
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
