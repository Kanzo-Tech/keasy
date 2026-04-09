import { ApiError } from "./client";

/**
 * Yields parsed JSON payloads from an SSE stream.
 * Uses native Web Streams API — no external dependencies.
 */
export async function* fetchSSEJson<T>(
  url: string,
  body?: unknown,
): AsyncGenerator<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let text: Record<string, unknown> | null = null;
    try { text = JSON.parse(raw); } catch { /* not JSON */ }
    const msg =
      text?.error && typeof text.error === "object" && (text.error as Record<string, unknown>).message
        ? String((text.error as Record<string, unknown>).message)
        : text?.message ? String(text.message) : raw || `Request failed (${res.status})`;
    const code =
      text?.error && typeof text.error === "object"
        ? String((text.error as Record<string, unknown>).code ?? "request_error")
        : "request_error";
    throw new ApiError(code, msg);
  }

  if (!res.body) return;

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine) yield JSON.parse(dataLine.slice(5).trim()) as T;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
