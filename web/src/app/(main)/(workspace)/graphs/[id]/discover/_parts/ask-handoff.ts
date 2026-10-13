import { useEffect, useRef } from "react";

/**
 * The question the assistant hands to Ask: its last turn links to `?panel=ask&q=<question>`
 * (docs/design/assistant.md), and Discover asks it once the model is ready — once: the parameter
 * leaves the URL as it is sent, in place, so a refresh, Back or a link copied afterwards does not ask
 * it again.
 */

/** The question `href` carries, and `href` without it. */
export function takeQuestion(href: string): { question: string | null; rest: string } {
  const url = new URL(href);
  const question = url.searchParams.get("q")?.trim() || null;
  url.searchParams.delete("q");
  return { question, rest: `${url.pathname}${url.search}${url.hash}` };
}

/**
 * Send the handed question with `send` once `ready` — the model loaded, the chat drawn — and take it
 * off the URL. Nothing when the URL carries none.
 */
export function useHandedQuestion(send: (question: string) => void, ready: boolean): void {
  const sent = useRef(false);
  useEffect(() => {
    if (!ready || sent.current) return;
    const { question, rest } = takeQuestion(window.location.href);
    if (question === null) return;
    sent.current = true;
    // In place, as the view and the dock are written (`discover-url.ts`): no navigation, no entry.
    window.history.replaceState(null, "", rest);
    send(question);
  }, [ready, send]);
}
