import "client-only";

import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError, type ErrorBody, type paths } from "@keasy/api";
import type { MaybeOptionalInit } from "openapi-fetch";

import { http } from "./client";

interface SseFrame {
  event: string;
  data: string;
}

/**
 * The `error` frame's payload: the same `ErrorBody` a refused request carries. A frame that does not
 * parse is still a failure the stream reported, so it is `llm/failed` with the frame as its words.
 */
export function sseFailure(frame: SseFrame): ErrorBody | null {
  if (frame.event !== "error") return null;
  try {
    const body = JSON.parse(frame.data) as Partial<ErrorBody> | null;
    if (body && typeof body.code === "string") return body as ErrorBody;
  } catch {
    // Not JSON: reported below with the frame as its detail.
  }
  return { code: "llm/failed", title: "The model call failed", detail: frame.data, data: {} };
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
    if (failure) throw new ApiError(failure);
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
 * error middleware, the same deadline — and yield its SSE frames as
 * `{ event, data }`. The deadline is per chunk of raw bytes, so the server's
 * `:keep-alive` comments keep a live stream open and only a silent one is cut,
 * as `server/silent`. A consumer that stops early cancels the response.
 */
export async function* stream<P extends StreamPath>(
  path: P,
  init: MaybeOptionalInit<paths[P], "post">,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  // One generic call over a union of paths is past what openapi-fetch infers;
  // `init` is already checked against `paths[P]` above.
  const { response } = await http.POST(path, { ...init, parseAs: "stream", signal } as never);
  if (!response.body) {
    throw new ApiError({
      code: "bff/failed",
      title: "The stream came back empty",
      detail: `${path} answered ${response.status} with no body to stream.`,
      data: {},
    });
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();

  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      if (value.data) yield { event: value.event ?? "message", data: value.data };
    }
  } finally {
    // An early `return`/`break` or a throw: end the response rather than leave it open until the
    // server finishes. A cancel that itself fails is on a stream already failing, and that failure
    // is the one propagating.
    if (!finished) await reader.cancel().catch(() => undefined); // the original failure propagates
  }
}
