"use client";

import { useEffect } from "react";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { AnswerCard, askEdit, AskChips, type AskOutput } from "@kanzo-tech/ai/data";
import { Spinner } from "@kanzo-tech/ui";
import { Boundary } from "@/components/boundary";
import { problemCopy, ProblemView } from "@/components/problem-view";
import { useModelLoad } from "@/lib/ai";
import { useCorpusAsk } from "@/lib/fossil/ask";
import { type Corpus, CorpusScope } from "@/lib/fossil/corpus";
import type { PreviewState } from "@/lib/fossil/preview";
import type { Question } from "./model";
import { Said } from "./turns";

/** How many rows of each file the preview reads: `run`'s `limit` for `into: "memory"`. */
const ROWS = 200;

/** A tool call that will never settle: the chat is not streaming it, and it has no output. */
const UNSETTLED = new Set(["input-streaming", "input-available"]);

export type Preview = PreviewState & { rerun: () => void };

/**
 * *Here is your data over 200 rows* — the preview, in the chat (docs/design/assistant.md, *the
 * preview is in the chat*): each question the person kept, answered over it with Ask's cards. A
 * decision changed runs it again: the answers it replaces stay on screen, dimmed under *Updating…*
 * beside the heading, until the new ones land — and stay dimmed if the run fails.
 */
export function PreviewTurn({ preview, questions }: { preview: Preview; questions: readonly Question[] }) {
  if (preview.state === "idle") {
    return (
      <Said>
        <Working>Writing how your files become a graph…</Working>
      </Said>
    );
  }
  const { corpus } = preview;
  const stale = corpus !== null && preview.state !== "ready";
  return (
    <Said label="Preview">
      {corpus && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-base">
          <span className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-4 text-primary" />
            Here is your data over its first {ROWS} rows
          </span>
          {preview.state === "running" && (
            <span className="flex items-center gap-1.5 font-normal text-muted-foreground text-sm" role="status">
              <Spinner aria-hidden />
              Updating…
            </span>
          )}
        </p>
      )}
      {preview.state === "running" && !corpus && <Working>Running a preview over the first {ROWS} rows of each file…</Working>}
      {preview.state === "failed" && <ProblemView error={preview.problem} onRetry={preview.rerun} />}
      {corpus && (
        // The answers being replaced: still there to read, but plainly not the ones to act on.
        <div
          aria-busy={preview.state === "running" || undefined}
          className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}
          data-stale={stale || undefined}
          inert={stale || undefined}
        >
          <Answers corpus={corpus} questions={questions} />
        </div>
      )}
    </Said>
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

/** The questions answered over `corpus`, each one Ask's turn: a new corpus is a new chat, asked again. */
function Answers({ corpus, questions }: { corpus: Corpus; questions: readonly Question[] }) {
  if (questions.length === 0) {
    return <p className="text-muted-foreground">You kept no questions. Build the whole graph and ask it anything in Discover.</p>;
  }
  return (
    <Boundary fallback={<Working>Reading the preview…</Working>}>
      <CorpusScope corpus={corpus} key={corpus.name}>
        <Asked questions={questions} />
      </CorpusScope>
    </Boundary>
  );
}

/**
 * Ask over the preview, as Discover's panel runs it (`useCorpusAsk`): each kept question sent in turn
 * once the model is ready — one at a time, as a chat answers — and each answer an `AnswerCard` with
 * its `AskChips`, which ask an edited spec again with no model.
 */
function Asked({ questions }: { questions: readonly Question[] }) {
  const { chat, graph, over } = useCorpusAsk();
  const ready = useModelLoad().state === "ready";
  const { messages, status, sendMessage } = chat;
  const sent = messages.filter((m) => m.role === "user").length;
  // The next question, once the last one is answered: a chat answers one at a time.
  const next = ready && (status === "ready" || status === "error") && sent < questions.length ? questions[sent].text : null;
  useEffect(() => {
    if (next !== null) void sendMessage({ text: next });
  }, [next, sendMessage]);

  const streaming = status === "streaming" || status === "submitted";
  return (
    <div className="flex flex-col gap-4" data-preview-answers="">
      {!ready && <Working>Preparing the model to answer your questions…</Working>}
      {messages.map((message, index) =>
        message.role === "user" ? (
          <p className="flex items-center gap-2 pt-2 font-medium" key={message.id}>
            <MessageCircleQuestion aria-hidden className="size-4 text-muted-foreground" />
            {message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ")}
          </p>
        ) : (
          <div className="flex flex-col gap-2" key={message.id}>
            {message.parts.map((part, i) => {
              const key = `${message.id}-${i}`;
              if (part.type === "text")
                return (
                  <p className="whitespace-pre-wrap" key={key}>
                    {part.text}
                  </p>
                );
              if (part.type !== "tool-answer") return null;
              const stopped = !(streaming && index === messages.length - 1) && UNSETTLED.has(part.state);
              const spec = part.state === "output-available" ? (part.output as AskOutput).spec : undefined;
              return (
                <div className="flex flex-col gap-2" key={key}>
                  <AnswerCard copy={problemCopy} graph={graph} part={part} stopped={stopped} />
                  {spec && <AskChips onChange={(edited) => void sendMessage(askEdit(edited))} over={over} spec={spec} />}
                </div>
              );
            })}
          </div>
        ),
      )}
      {status === "submitted" && <Working>Answering…</Working>}
      {chat.error !== undefined && <ProblemView error={chat.error} uncoded="llm/failed" />}
    </div>
  );
}
