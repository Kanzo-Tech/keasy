"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Code, History } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  MessageList,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@kanzo-tech/ai";
import { Alert, AlertDescription, AlertTitle, Button, InputGroupButton } from "@kanzo-tech/ui";
import type { AssistantMessage, FileReference } from "@/lib/assistant-conversation";
import { converse, messagesOf, NO_REPLIES, type Replies, type Turn, waitingFor, type Waiting } from "./conversation";
import type { AssistantData, BuildProgress, Question } from "./model";
import { type Preview, PreviewTurn } from "./preview-turn";
import type { SourcePickerProps } from "./source-picker";
import {
  AboutTurn,
  Answerable,
  AskDone,
  AskTurn,
  AssumedTurn,
  BuildTurn,
  DecideTurn,
  PickTurn,
  ReadingTurn,
  Reply,
  TaskFailed,
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
  /** Above the first turn: whether the model the Tasks ask is ready on this device. */
  status?: ReactNode;
  /** Each change of what the person has replied: what the hook's Tasks wait on. */
  onReplies?: (replies: Replies) => void;
  /** The picked files as locations: what the conversation keeps of them. */
  files: readonly FileReference[];
  /** The program the mapping wrote, `null` until it has: what the preview runs and the build builds. */
  program: string | null;
  /** The preview of `program`, answered in the chat. */
  preview: Preview;
  /** The whole graph's build, `null` until the person asks for it. */
  build: BuildProgress | null;
  /** *Build the whole graph*, with the transcript to save first: a graph is built from a kept conversation. */
  onBuild: (messages: AssistantMessage[]) => void;
  /** The transcript as it is kept, after each reply of the person's: structure only (`messagesOf`). */
  onSave?: (messages: AssistantMessage[]) => void;
  /** Where a kept conversation stood: the chat starts there. */
  initial?: Replies;
  /** A decision to open at its options — Discover's **Change** — once the conversation reaches it. */
  reopen?: string | null;
  /** A graph was built from this conversation: what is changed here is kept as a new one. */
  built?: boolean;
}

let written = 0;

/**
 * The guided chat (docs/design/assistant.md): the assistant's turns as `converse` orders them, each
 * carrying what it is about, and the person's replies as their messages. What the hook answers is
 * read here, the person's questions with it; what else they have replied — whether the files were
 * sent, what it is about, that they asked all they wanted — is kept here. The composer takes free text only where the turn above asks for it.
 * The transcript is kept as its structure (`messagesOf`) after each reply, and a kept one starts the
 * chat where it stood (`initial`); its last turns are the preview and the build, on request.
 */
export function AssistantChat(props: AssistantChatProps) {
  const { onAdvanced, onBack, questions, onReplies, onSave, reopen = null } = props;
  const [replies, setReplies] = useState<Replies>(props.initial ?? NO_REPLIES);
  useEffect(() => onReplies?.(replies), [replies, onReplies]);
  // Saving starts with the person's first reply here: a conversation opened and only read is not
  // saved again — over a built one, that would start a new conversation nobody asked for.
  const [replied, setReplied] = useState(false);
  const reply = (next: Partial<Replies>) => {
    setReplied(true);
    setReplies((prev) => ({ ...prev, ...next }));
  };
  const onChoose = (decision: string, option: string) => {
    setReplied(true);
    props.onChoose(decision, option);
  };
  const onQuestionsChange = (next: Question[]) => {
    setReplied(true);
    props.onQuestionsChange(next);
  };
  const { turns, waiting } = converse(props, replies);

  // The transcript as it is kept, saved whenever it changes after a reply — but not while the files
  // are read or the `model` Task answers, when the turns after them are not said yet and a save
  // would drop them.
  const messages = messagesOf(turns, { files: props.files, program: props.program });
  const transcript = JSON.stringify(messages);
  const settling =
    waiting === "reading" ||
    (replies.about !== undefined && props.decisions === null && !props.failures.some((f) => f.task === "model"));
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!replied || settling || transcript === last.current) return;
    last.current = transcript;
    onSave?.(JSON.parse(transcript) as AssistantMessage[]);
  }, [replied, settling, transcript, onSave]);

  // Discover's **Change**: the decision's turn brought into view once the conversation says it.
  const reopened = useRef(false);
  const reached = reopen !== null && turns.some((t) => "item" in t && t.item.decision.id === reopen);
  useEffect(() => {
    if (!reached || reopened.current) return;
    reopened.current = true;
    document.querySelector(`[data-decision="${CSS.escape(reopen!)}"]`)?.scrollIntoView?.({ block: "center" });
  }, [reached, reopen]);

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
            sources={props.sources}
          />
        );
      case "picked":
        return (
          <Reply key={key}>{turn.files === 1 ? "This file" : `These ${turn.files} files`}</Reply>
        );
      case "reading":
        return <ReadingTurn key={key} problems={props.problems} reading={turn.reading} total={props.selected.size} />;
      case "about":
        return <AboutTurn key={key} />;
      case "about-reply":
        return <Reply key={key}>{turn.text || <span className="text-muted-foreground">Skip that, just read them</span>}</Reply>;
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
        // Kept in the transcript, not drawn: the option chosen stays selected in the decision's turn.
        return null;
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
          <Reply
            key={turn.question.id}
            onRemove={
              waiting === "ask" ? () => onQuestionsChange(questions.filter((q) => q.id !== turn.question.id)) : undefined
            }
          >
            <span data-question={turn.question.id}>{turn.question.text}</span>
            <Answerable answerable={turn.question.answerable} />
          </Reply>
        );
      case "asked-all":
        return <Reply key={key}>{turn.questions === 0 ? "No questions for now. Show me." : "That's all. Show me."}</Reply>;
      case "preview":
        return <PreviewTurn key={key} preview={props.preview} questions={questions} />;
      case "build":
        return (
          <BuildTurn
            build={props.build}
            key={key}
            onBuild={() => props.onBuild(messages)}
            questions={questions}
            ready={props.program !== null}
          />
        );
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

      {/* A turn added takes the pin back, as Conversation's own does; reading back up releases it. */}
      <Conversation>
        <ConversationContent className="py-8">
          <MessageList className="gap-5">
            {props.status}
            {props.built && (
              <Alert data-built="" variant="info">
                <History aria-hidden />
                <AlertTitle>A graph was built from this conversation</AlertTitle>
                <AlertDescription>
                  It stays as it was built. What you change here is kept as a new conversation, and building again makes a new
                  graph.
                </AlertDescription>
              </Alert>
            )}
            {turns.map(draw)}
            {props.failures.map((f) => (
              <TaskFailed failure={f} key={f.task} />
            ))}
            {waiting === "ask" && <AskDone onDone={() => reply({ asked: true })} questions={questions.length} />}
          </MessageList>
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

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
        <PromptInput
          className="bg-card"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <PromptInputTextarea
            aria-label={waiting === "about" ? "What is this data about?" : "Your question"}
            className="min-h-14"
            onChange={(e) => setDraft(e.target.value)}
            placeholder={waiting === "about" ? ABOUT_EXAMPLE : "Ask your own question…"}
            value={draft}
          />
          <PromptInputToolbar className="justify-end">
            {waiting === "about" && (
              <InputGroupButton onClick={() => onAbout("")} size="sm" variant="ghost">
                Skip
              </InputGroupButton>
            )}
            <PromptInputSubmit className="ms-0" disabled={!draft.trim()} />
          </PromptInputToolbar>
        </PromptInput>
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
