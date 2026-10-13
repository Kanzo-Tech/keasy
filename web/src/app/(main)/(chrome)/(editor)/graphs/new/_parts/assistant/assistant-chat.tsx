"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Code, SendHorizontal } from "lucide-react";
import { MessageList } from "@kanzo-tech/ai";
import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@kanzo-tech/ui";
import { converse, NO_REPLIES, type Replies, type Turn, waitingFor, type Waiting } from "./conversation";
import type { AssistantData, Question } from "./model";
import type { SourcePickerProps } from "./source-picker";
import {
  AboutReply,
  AboutTurn,
  AskDone,
  AskedAllReply,
  AskedReply,
  AskTurn,
  AssumedTurn,
  BuildTurn,
  DecidedReply,
  DecideTurn,
  PickedReply,
  PickTurn,
  ReadingTurn,
  UnderstoodTurn,
} from "./turns";

export interface AssistantChatProps
  extends AssistantData,
    Pick<SourcePickerProps, "expanded" | "onExpandedChange" | "onSelectedChange"> {
  onChoose: (decision: string, option: string) => void;
  /** The person's questions, kept by the host, which says whether each can be answered. */
  questions: readonly Question[];
  onQuestionsChange: (questions: Question[]) => void;
  onAdvanced: () => void;
  onBack: () => void;
}

let written = 0;

/**
 * The guided chat (docs/design/assistant.md): the assistant's turns as `converse` orders them, each
 * carrying what it is about, and the person's replies as their messages. What the hook answers is
 * read here, the person's questions with it; what else they have replied — whether the files were
 * sent, what it is about, that they asked all they wanted — is kept here. The composer takes free text only where the turn above asks for it.
 */
export function AssistantChat(props: AssistantChatProps) {
  const { onAdvanced, onBack, onChoose, questions, onQuestionsChange } = props;
  const [replies, setReplies] = useState<Replies>(NO_REPLIES);
  const reply = (next: Partial<Replies>) => setReplies((prev) => ({ ...prev, ...next }));
  const { turns, waiting } = converse(props, replies);

  // A turn added is where the person is looking: the transcript follows it. Nothing here streams,
  // so following each new turn is all the pin there is.
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, waiting]);

  const ask = (id: string, text: string) => {
    const t = text.trim();
    if (!t || questions.some((q) => q.text === t)) return;
    onQuestionsChange([...questions, { id, text: t, answerable: null }]);
  };

  const draw = (turn: Turn, index: number) => {
    const key = `${turn.kind}-${index}`;
    switch (turn.kind) {
      case "pick":
        return (
          <PickTurn
            expanded={props.expanded}
            key={key}
            live={waiting === "pick"}
            onExpandedChange={props.onExpandedChange}
            onPicked={() => reply({ picked: true })}
            onSelectedChange={props.onSelectedChange}
            reason={waitingFor("pick", props.selected.size)}
            selected={props.selected}
            tree={props.sources}
          />
        );
      case "picked":
        return <PickedReply files={turn.files} key={key} onChange={() => reply({ picked: false })} />;
      case "reading":
        return <ReadingTurn key={key} problems={props.problems} reading={turn.reading} total={props.selected.size} />;
      case "about":
        return <AboutTurn key={key} />;
      case "about-reply":
        return <AboutReply key={key} text={turn.text} />;
      case "understood":
        return <UnderstoodTurn key={key} relations={props.understanding.relations} things={props.understanding.things} />;
      case "decide":
        return (
          <DecideTurn
            index={turn.index}
            item={turn.item}
            key={turn.item.decision.id}
            of={turn.of}
            onChoose={(option) => onChoose(turn.item.decision.id, option)}
          />
        );
      case "decided":
        return <DecidedReply item={turn.item} key={key} />;
      case "assumed":
        return (
          <AssumedTurn
            item={turn.item}
            key={turn.item.decision.id}
            onChoose={(option) => onChoose(turn.item.decision.id, option)}
          />
        );
      case "ask":
        return (
          <AskTurn key={key} live={waiting === "ask"} offers={props.offers} onAsk={ask} questions={questions} />
        );
      case "asked":
        return (
          <AskedReply
            key={turn.question.id}
            onRemove={
              waiting === "ask"
                ? () => onQuestionsChange(questions.filter((q) => q.id !== turn.question.id))
                : undefined
            }
            question={turn.question}
          />
        );
      case "asked-all":
        return <AskedAllReply key={key} questions={turn.questions} />;
      case "build":
        return <BuildTurn build={props.build} key={key} questions={questions} />;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <Button onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft />
          Graphs
        </Button>
        <h1 className="flex-1 truncate text-center font-medium text-sm">New graph</h1>
        <Button onClick={onAdvanced} size="sm" title="Write the shapes and the program yourself" variant="ghost">
          <Code />
          Advanced
        </Button>
      </header>

      {/* `role="log"`: a turn added is announced after what the reader is on, not over it. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={log} role="log">
        <MessageList className="mx-auto max-w-3xl gap-5 px-4 py-8">
          {turns.map(draw)}
          {waiting === "ask" && <AskDone onDone={() => reply({ asked: true })} questions={questions.length} />}
        </MessageList>
      </div>

      <Composer
        onAbout={(text) => reply({ about: text })}
        onAsk={(text) => ask(`written-${++written}`, text)}
        // The pick's own reason is beside its button, in the turn.
        reason={waiting === "pick" ? null : waitingFor(waiting, props.selected.size)}
        waiting={waiting}
      />
    </div>
  );
}

const ABOUT_EXAMPLE = "e.g. Nobel prizes and the people who won them";

/**
 * Free text, where the turn above asks for it: what the data is about, or a question. Anywhere else
 * the composer is not drawn, and what the conversation waits on is said in its place.
 */
function Composer({
  waiting,
  reason,
  onAbout,
  onAsk,
}: {
  waiting: Waiting;
  reason: string | null;
  onAbout: (text: string) => void;
  onAsk: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  if (waiting === null) return null;
  const writing = waiting === "about" || waiting === "ask";
  const send = () => {
    if (waiting === "about") onAbout(draft.trim());
    else if (draft.trim()) onAsk(draft);
    setDraft("");
  };
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
      {writing ? (
        <InputGroup asChild className="rounded-xl bg-card shadow-xs/5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <InputGroupTextarea
              aria-label={waiting === "about" ? "What is this data about?" : "Your question"}
              className="max-h-48 min-h-14"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }}
              placeholder={waiting === "about" ? ABOUT_EXAMPLE : "Ask your own question…"}
              rows={1}
              value={draft}
            />
            <InputGroupAddon align="block-end" className="justify-end gap-1">
              {waiting === "about" && (
                <InputGroupButton onClick={() => onAbout("")} size="sm" variant="ghost">
                  Skip
                </InputGroupButton>
              )}
              <InputGroupButton aria-label="Send" disabled={!draft.trim()} size="icon-sm" type="submit" variant="default">
                <SendHorizontal />
              </InputGroupButton>
            </InputGroupAddon>
          </form>
        </InputGroup>
      ) : (
        reason && (
          <p className="flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-muted-foreground text-sm">
            <ArrowUp aria-hidden className="size-4" />
            {reason}
          </p>
        )
      )}
    </div>
  );
}
