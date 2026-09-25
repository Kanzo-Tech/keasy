import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError, apiError, type ErrorBody } from "@keasy/api";

export interface SseFrame {
  event: string;
  data: string;
}

/** The `error` frame's payload: the same `ErrorBody` a refused request carries. */
export function sseFailure(frame: SseFrame): ErrorBody | null {
  return frame.event === "error" ? (JSON.parse(frame.data) as ErrorBody) : null;
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
    if (failure) throw new ApiError(failure.error, failure.message);
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

  if (!res.ok) throw await apiError(res);
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
