import { EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError, apiError, type ErrorBody, type Schemas } from "@keasy/api";

export type CompletionRequest = Schemas["CompletionRequest"];
export type ChatMessage = Schemas["ChatMessage"];

/**
 * One model call through the server's `/v1/ai/stream`, yielding each text
 * chunk as it arrives. A refusal, or an `error` frame mid-stream, throws an
 * {@link ApiError} carrying the server's code.
 */
export async function* streamText(
  request: CompletionRequest,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch("/v1/ai/stream", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
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
      if (done) return;
      if (value.event === "error") {
        const body = JSON.parse(value.data) as ErrorBody;
        throw new ApiError(body.error, body.message);
      }
      if (value.event === "delta") yield value.data;
    }
  } finally {
    reader.releaseLock();
  }
}

/** The whole answer, with `onDelta` seeing it grow. */
export async function completeText(
  request: CompletionRequest,
  signal?: AbortSignal,
  onDelta?: (delta: string) => void,
): Promise<string> {
  let text = "";
  for await (const delta of streamText(request, signal)) {
    text += delta;
    onDelta?.(delta);
  }
  return text;
}

/** A model's JSON answer, without the markdown fence it may have wrapped it in. */
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const open = trimmed.match(/^```[a-z]*\n?/);
  if (!open) return trimmed;
  const body = trimmed.slice(open[0].length);
  return (body.endsWith("```") ? body.slice(0, -3) : body).trim();
}
