import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError, type ErrorBody, type paths } from "@keasy/api";
import type { MaybeOptionalInit } from "openapi-fetch";

import { http } from "./client";

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

/** The routes whose answer the spec declares as `text/event-stream`. */
type StreamPath = {
  [P in keyof paths]: paths[P] extends {
    post: { responses: { 200: { content: { "text/event-stream": unknown } } } };
  }
    ? P
    : never;
}[keyof paths];

/**
 * POST to a streaming endpoint through `http` — the same path types, the same
 * error middleware — and yield its SSE frames as `{ event, data }`.
 */
export async function* stream<P extends StreamPath>(
  path: P,
  init: MaybeOptionalInit<paths[P], "post">,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  // One generic call over a union of paths is past what openapi-fetch infers;
  // `init` is already checked against `paths[P]` above.
  const { response } = await http.POST(path, { ...init, parseAs: "stream", signal } as never);
  if (!response.body) return;

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.data) yield { event: value.event ?? "message", data: value.data };
    }
  } finally {
    reader.releaseLock();
  }
}
