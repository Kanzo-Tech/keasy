"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { Link } from "@kanzo-tech/navigation/next";
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
import { Alert, AlertDescription, AlertTitle, Button } from "@kanzo-tech/ui";
import { HeaderEnd } from "@/app/(main)/_parts/header-end";
import type { AssistantMessage, FileReference } from "@/lib/assistant-conversation";
import { converse, graphName, messagesOf, NO_REPLIES, type Replies, type Turn, waitingFor, type Waiting } from "./conversation";
import type { AssistantData, BuildProgress, Question } from "./model";
import { type Preview, PreviewTurn, ROWS } from "./preview-turn";
import { Source, Sources, SourcesContent, SourcesTrigger } from "./sources";
import { SourceBar, type SourceBarProps } from "./source-bar";
import { stepsOf } from "./steps";
import {
  Answerable,
  AskDone,
  AskTurn,
  AssumedTurn,
  BuildTurn,
  DecideTurn,
  Reply,
  SentTurn,
  StepsTurn,
  TaskFailed,
  UnderstoodTurn,
} from "./turns";

export interface AssistantChatProps extends AssistantData {
  /** Pick files, or drop them, and drop a connection's: what the pills above the field do. */
  onPick: SourceBarProps["onPick"];
  onClear: SourceBarProps["onClear"];
  onChoose: (decision: string, option: string) => void;
  /** The person's questions, kept by the host, which says whether each can be answered. */
  questions: readonly Question[];
  onQuestionsChange: (questions: Question[]) => void;
  /** **Open in the editor**, on the step that wrote the program. */
  onAdvanced: () => void;
  /** The mapping is writing the program again: a decision changed. */
  writing: boolean;
  /** At the end of the app's header: whether the model the Tasks ask is ready on this device. */
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
  /** *Build the graph*, with the transcript to save first: a graph is built from a kept conversation. */
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
  const { onAdvanced, questions, onReplies, onSave, reopen = null } = props;
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
  const { turns, waiting, closed } = converse(props, replies);

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

  // Discover's **Change**: the decision's turn brought into view once the conversation says it — and,
  // over a built conversation, the note saying so drawn just above it, where the page lands.
  const reopens = (t: Turn) => (t.kind === "decide" || t.kind === "assumed") && t.item.decision.id === reopen;
  const reached = reopen !== null && turns.some(reopens);
  const reopened = useRef(false);
  useEffect(() => {
    if (!reached || reopened.current) return;
    reopened.current = true;
    const at = props.built ? document.querySelector("[data-built]") : document.querySelector(`[data-decision="${CSS.escape(reopen!)}"]`);
    at?.scrollIntoView?.({ block: props.built ? "start" : "center" });
  }, [reached, reopen, props.built]);
  const built = props.built && (
    <Alert data-built="" key="built" variant="info">
      <History aria-hidden />
      <AlertTitle>A graph was built from this conversation</AlertTitle>
      <AlertDescription>
        It stays as it was built. What you change here is kept as a new conversation, and building again makes a new graph.
      </AlertDescription>
    </Alert>
  );

  const ask = (id: string, text: string) => {
    const t = text.trim();
    if (!t || questions.some((q) => q.text === t)) return;
    onQuestionsChange([...questions, { id, text: t, answerable: null }]);
  };

  // *Build the graph*: the person's message is part of the transcript, which is saved before the
  // graph is built from it — and so is not saved again by the effect above.
  const buildNow = () => {
    const next = messagesOf(converse(props, { ...replies, built: true }).turns, { files: props.files, program: props.program });
    last.current = JSON.stringify(next);
    reply({ built: true });
    props.onBuild(next);
  };

  const facts = {
    files: props.selected.size,
    reading: props.reading,
    things: props.understanding.things,
    decisions: props.decisions,
    failures: props.failures,
    asked: replies.asked,
    program: props.program,
    writing: props.writing,
    preview: props.preview.state,
    build: props.build,
  };

  const draw = (turn: Turn, index: number) => {
    const key = `${turn.kind}-${index}`;
    switch (turn.kind) {
      case "sent":
        return <SentTurn about={turn.about} key={key} sources={turn.sources} />;
      case "steps":
        return (
          <StepsTurn
            key={`steps-${turn.group}`}
            onEditor={onAdvanced}
            problems={turn.group === "read" ? props.problems : undefined}
            steps={stepsOf(turn.group, facts, ROWS)}
          />
        );
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
            open={turn.item.decision.id === reopen}
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
      case "build-reply":
        return <Reply key={key}>Build the graph</Reply>;
      case "build":
        return (
          <BuildTurn build={props.build} key={key} onBuild={buildNow} questions={questions} ready={props.program !== null} />
        );
    }
  };

  const name = graphName(props.files);
  const sent = replies.about !== undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <HeaderEnd>{props.status}</HeaderEnd>

      {/* What the thread was made from, pinned above it: the steps never move it. */}
      {sent && (
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-1 border-b px-4 py-2.5" data-details="">
          {replies.about && <p className="truncate font-medium text-sm">{replies.about}</p>}
          <Sources>
            <SourcesTrigger count={props.files.length} />
            <SourcesContent>
              {props.files.map((f) => (
                <Source key={`${f.connection}:${f.path}`}>
                  @{f.connection}/{f.path}
                </Source>
              ))}
            </SourcesContent>
          </Sources>
        </div>
      )}

      {/* A turn added takes the pin back, as Conversation's own does; reading back up releases it. */}
      <Conversation>
        <ConversationContent className="py-8">
          <MessageList className="gap-5">
            {turns.length === 0 && (
              <div className="flex flex-col gap-1.5" data-empty="">
                <h2 className="font-semibold text-xl">What would you like to explore?</h2>
                <p className="text-muted-foreground">
                  Add a connection&rsquo;s files from the badges below, and say what they are about if you like.
                </p>
              </div>
            )}
            {!reached && built}
            {turns.flatMap((turn, index) => (reached && reopens(turn) ? [built, draw(turn, index)] : [draw(turn, index)]))}
            {props.failures.map((f) => (
              <TaskFailed failure={f} key={f.task} />
            ))}
            {waiting === "ask" && <AskDone onDone={() => reply({ asked: true })} questions={questions.length} />}
          </MessageList>
        </ConversationContent>
        {/* At the log's end edge, not its middle: the turns' actions — *Build the graph*, *That's all* —
            sit at its start, and a button floating over the log never covers them. */}
        <ConversationScrollButton className="inset-x-auto end-4" />
      </Conversation>

      {closed ? (
        <ClosedBar name={name} />
      ) : (
        <Composer
          onAsk={(text) => ask(`written-${++written}`, text)}
          onPick={props.onPick}
          onClear={props.onClear}
          onSend={(text) => reply({ about: text })}
          connections={props.connections}
          list={props.list}
          placeholder={waitingFor(waiting)}
          selected={props.selected}
          waiting={waiting}
        />
      )}
    </div>
  );
}

const ABOUT_EXAMPLE = "e.g. Nobel prizes and the people who won them";

/**
 * The conversation, once the graph is built from it: the composer gives way to a bar saying so, and
 * the way on — a new conversation, which the page opens clean for the `new` it is given.
 */
function ClosedBar({ name }: { name: string }) {
  // The page keys its conversation on this, so the same route opens a conversation of its own.
  const [fresh] = useState(() => crypto.randomUUID());
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-dashed bg-muted/40 px-4 py-3.5 text-muted-foreground"
        data-closed=""
      >
        <span className="flex-1">
          This conversation built <b className="text-foreground">{name}</b>, and stays as it was built.
        </span>
        <Button asChild variant="outline">
          <Link href={`/graphs/new/assistant?new=${fresh}`}>Start a new one from here</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The one composer, whatever the thread waits on. Sending the first message: the sources are pills
 * above the field and the field says what they are about. Asking a question: free text. Waiting on
 * something above, it stays where it is, off, and says what it waits for in its placeholder. After
 * the questions are asked there is none (a question beyond them is asked in Discover).
 */
function Composer({
  waiting,
  placeholder,
  connections,
  list,
  selected,
  onPick,
  onClear,
  onSend,
  onAsk,
}: {
  waiting: Waiting;
  placeholder: string | null;
} & Pick<SourceBarProps, "connections" | "list" | "selected" | "onPick" | "onClear"> & {
    onSend: (about: string) => void;
    onAsk: (text: string) => void;
  }) {
  const [draft, setDraft] = useState("");
  if (waiting === null) return null;
  const writing = waiting === "send" || waiting === "ask";
  // The first message needs a source; a question needs words.
  const canSend = waiting === "send" ? selected.size > 0 : waiting === "ask" && draft.trim() !== "";
  const send = () => {
    if (!canSend) return;
    if (waiting === "send") onSend(draft.trim());
    else onAsk(draft);
    setDraft("");
  };
  return (
    <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
      <PromptInput
        className="bg-card"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {waiting === "send" && <SourceBar connections={connections} list={list} onClear={onClear} onPick={onPick} selected={selected} />}
        <PromptInputTextarea
          aria-label={waiting === "send" ? "What is this data about?" : "Your question"}
          className="min-h-14"
          disabled={!writing}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={writing ? (waiting === "send" ? ABOUT_EXAMPLE : "Ask your own question…") : (placeholder ?? "")}
          value={draft}
        />
        <PromptInputToolbar className="justify-end">
          <PromptInputSubmit className="ms-0" disabled={!canSend} />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}
