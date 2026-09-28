import type { Schemas } from "@keasy/api";

import { failOnError, stream } from "@/lib/api/sse";

export type CompletionRequest = Schemas["CompletionRequest"];
export type ChatMessage = Schemas["ChatMessage"];

/**
 * One model call through the server's `/v1/ai/stream`, yielding each text
 * chunk as it arrives. A refusal, or an `error` frame mid-stream, throws an
 * `ApiError` carrying the server's code.
 */
export async function* streamText(
  request: CompletionRequest,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  for await (const frame of failOnError(stream("/v1/ai/stream", { body: request }, signal))) {
    if (frame.event === "delta") yield frame.data;
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
