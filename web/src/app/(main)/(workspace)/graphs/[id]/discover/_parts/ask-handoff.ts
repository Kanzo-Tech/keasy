import { useEffect, useRef } from "react";

/**
 * The question the assistant hands to Ask: its last turn links to `?panel=ask&q=<question>`
 * (docs/design/assistant.md), and Discover asks it once the model is ready — once: the parameter
 * leaves the URL as it is sent, in place, so a refresh, Back or a link copied afterwards does not ask
 * it again.
 */

/** Discover's Ask over graph `graphId`, handed `question` when there is one: what the assistant links to. */
export const askHref = (graphId: string, question?: string) =>
  `/graphs/${graphId}/discover?panel=ask${question ? `&q=${encodeURIComponent(question)}` : ""}`;

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
 *
 * What a mount sent goes with it when it unmounts — the chat it was sent into is gone — so the
 * question is handed back to the next mount of the same component. That next mount is StrictMode's
 * rehearsal in development: a chat whose model is already loaded is sent into as it mounts, the
 * rehearsal drops that chat's message, and without this the question was taken off the URL and asked
 * nowhere. A real unmount takes the component with it, and the URL no longer carries the question.
 */
export function useHandedQuestion(send: (question: string) => void, ready: boolean): void {
  /** Taken off the URL and not yet sent; `undefined` until the URL is read. */
  const pending = useRef<string | null | undefined>(undefined);
  /** Sent by this mount: what its unmount hands back. */
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (pending.current === undefined) {
      const { question, rest } = takeQuestion(window.location.href);
      pending.current = question;
      // In place, as the view and the dock are written (`discover-url.ts`): no navigation, no entry.
      if (question !== null) window.history.replaceState(null, "", rest);
    }
    const question = pending.current;
    if (question === null) return;
    pending.current = null;
    sent.current = question;
    send(question);
  }, [ready, send]);
  useEffect(
    () => () => {
      if (sent.current === null) return;
      pending.current = sent.current;
      sent.current = null;
    },
    [],
  );
}

/**
 * Whether a question is the person's already: one was handed over by the assistant (`handed`, read
 * from the URL before it is sent), or the conversation holds a message, or an answer is on its way.
 * The offers Ask proposes are for an empty conversation and for nothing else — one generated while
 * the model is busy with a person's own question waits that question out (the local model takes calls
 * in turn), so they yield: they do not start, and one in flight is stopped.
 */
export function hasAsked({ handed, messages, status }: { handed: boolean; messages: number; status: string }): boolean {
  return handed || messages > 0 || status === "submitted" || status === "streaming";
}

/** Whether the URL carries a question for Ask, before `useHandedQuestion` takes it off. */
export const isHanded = () => typeof window !== "undefined" && takeQuestion(window.location.href).question !== null;
