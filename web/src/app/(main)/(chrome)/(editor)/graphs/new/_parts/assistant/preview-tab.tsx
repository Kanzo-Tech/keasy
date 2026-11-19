"use client";

import { useEffect } from "react";
import type { UIMessage } from "ai";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { Spinner } from "@kanzo-tech/ui";
import { askParts } from "@/components/ask-parts";
import { Boundary } from "@/components/boundary";
import { ProblemView } from "@/components/problem-view";
import { useModelLoad } from "@/lib/ai";
import { useGraphAsk } from "@/lib/fossil/ask";
import { type AttachedGraph, GraphScope } from "@/lib/fossil/graph";
import type { PreviewState } from "@/lib/fossil/preview";
import type { Question } from "./model";

/** How many rows of each file the preview reads: `run`'s `limit` for `into: "memory"`. */
export const ROWS = 200;

export type Preview = PreviewState & { rerun: () => void };

/**
 * The panel's *Preview* (docs/design/assistant.md, *the preview is in the panel*): each question the
 * person kept, answered over the first rows with Ask's cards. It runs as soon as there is a program,
 * over the defaults. A decision changed runs it again: the answers it replaces stay on screen, dimmed
 * under *Updating…*, until the new ones land — and stay dimmed if the run fails.
 */
export function PreviewTab({ preview, questions }: { preview: Preview; questions: readonly Question[] }) {
  const graph = preview.state === "idle" ? null : preview.graph;
  const stale = graph !== null && preview.state !== "ready";
  return (
    <section aria-label="Preview" className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium">
        <span className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-4 text-primary" />
          Your data over its first {ROWS} rows
        </span>
        {preview.state === "running" && graph && (
          <span className="flex items-center gap-1.5 font-normal text-muted-foreground text-sm" role="status">
            <Spinner aria-hidden />
            Updating…
          </span>
        )}
      </p>
      {preview.state === "failed" && <ProblemView error={preview.problem} onRetry={preview.rerun} />}
      {!graph && preview.state !== "failed" && <Working>Writing the program and running it over the first rows…</Working>}
      {graph && (
        // The answers being replaced: still there to read, but plainly not the ones to act on.
        <div
          aria-busy={preview.state === "running" || undefined}
          className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}
          data-stale={stale || undefined}
          inert={stale || undefined}
        >
          <Answers graph={graph} questions={questions} />
        </div>
      )}
      {graph && questions.length > 0 && (
        <p className="text-muted-foreground text-sm">
          These are the first {ROWS} rows of each file. The whole graph counts every row.
        </p>
      )}
    </section>
  );
}

function Working({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-muted-foreground" role="status">
      <Spinner aria-hidden />
      {children}
    </p>
  );
}

/** The questions answered over `graph`, each one Ask's turn: a new graph is a new chat, asked again. */
function Answers({ graph, questions }: { graph: AttachedGraph; questions: readonly Question[] }) {
  if (questions.length === 0) {
    return <p className="text-muted-foreground">Ask a question in the conversation, and it is answered here.</p>;
  }
  return (
    <Boundary fallback={<Working>Reading the preview…</Working>}>
      <GraphScope graph={graph} key={graph.name}>
        <Asked questions={questions} />
      </GraphScope>
    </Boundary>
  );
}

/**
 * Ask over the preview, as Discover's panel runs it (`useGraphAsk`): each kept question sent in turn
 * once the model is ready — one at a time, as a chat answers — and each part drawn as `Chat` draws it
 * (`askParts`): an answer as an `AnswerCard` with its `AskChips`, which ask an edited spec again with
 * no model, and a decision as a question.
 */
function Asked({ questions }: { questions: readonly Question[] }) {
  const { chat, graph } = useGraphAsk();
  const ready = useModelLoad().state === "ready";
  const { messages, status, sendMessage } = chat;
  const sent = messages.filter((m) => m.role === "user").length;
  // The next question, once the last one is answered: a chat answers one at a time.
  const next = ready && (status === "ready" || status === "error") && sent < questions.length ? questions[sent].text : null;
  useEffect(() => {
    if (next !== null) void sendMessage({ text: next });
  }, [next, sendMessage]);

  const streaming = status === "streaming" || status === "submitted";
  const parts = askParts({ graph, send: (message) => void sendMessage(message) });
  // A question and its answer are one cell: each answer under the question that asked it.
  return (
    <div className="flex flex-col gap-3" data-preview-answers="">
      {!ready && <Working>Preparing the model to answer your questions…</Working>}
      <div className="grid gap-3">
        {messages.map((message, index) =>
          message.role === "user" ? (
            <section className="flex flex-col gap-2 rounded-box border bg-card p-3.5" key={message.id}>
              <p className="flex items-center gap-2 font-medium">
                <MessageCircleQuestion aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                {message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ")}
              </p>
              {messages[index + 1]?.role === "assistant" && (
                <Answer
                  graphParts={parts}
                  message={messages[index + 1]!}
                  stopped={!(streaming && index + 1 === messages.length - 1)}
                />
              )}
            </section>
          ) : null,
        )}
      </div>
      {status === "submitted" && <Working>Answering…</Working>}
      {chat.error !== undefined && <ProblemView error={chat.error} uncoded="llm/failed" />}
    </div>
  );
}

/** What was answered to a question: its prose, and each data part drawn as `Chat` draws it (`askParts`). */
function Answer({
  message,
  graphParts,
  stopped,
}: {
  message: UIMessage;
  graphParts: ReturnType<typeof askParts>;
  /** Its read will never land: the chat is not streaming this message. */
  stopped: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        if (part.type === "text")
          return (
            <p className="whitespace-pre-wrap" key={key}>
              {part.text}
            </p>
          );
        if (!part.type.startsWith("data-")) return null;
        const draw = graphParts[part.type.slice("data-".length)];
        return <div key={key}>{draw?.(part as Parameters<NonNullable<typeof draw>>[0], { stopped })}</div>;
      })}
    </div>
  );
}
