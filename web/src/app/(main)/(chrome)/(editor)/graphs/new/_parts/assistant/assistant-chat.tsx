"use client";

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import {
  Button,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
  ShellAside,
} from "@kanzo-tech/ui";
import { HeaderEnd } from "@/app/(main)/_parts/header-end";
import type { AssistantMessage, FileReference } from "@/lib/assistant-conversation";
import { converse, graphName, isChange, messagesOf, NO_REPLIES, placeholderOf, type Replies, type Turn, type Waiting } from "./conversation";
import { type AssistantData, blocks, type BuildProgress, type Question } from "./model";
import { AssistantPanel, type PanelTab } from "./panel";
import type { Preview } from "./preview-tab";
import { SourceBar, type SourceBarProps } from "./source-bar";
import { workingOf } from "./working";
import {
  Answerable,
  AskTurn,
  AssumedTurn,
  BuildTurn,
  ChangeTurn,
  CheckpointTurn,
  DecideTurn,
  Reply,
  SentTurn,
  TaskFailed,
  UnderstoodTurn,
  WorkingLine,
} from "./turns";

export interface AssistantChatProps extends AssistantData {
  /** Pick files, or drop them, and drop a connection's: what the pills above the field do. */
  onPick: SourceBarProps["onPick"];
  onDrop: SourceBarProps["onDrop"];
  onChoose: (decision: string, option: string) => void;
  /** The person's questions, kept by the host, which says whether each can be answered. */
  questions: readonly Question[];
  onQuestionsChange: (questions: Question[]) => void;
  /** **Open in the editor**, on the panel once there is a program. */
  onAdvanced: () => void;
  /** The mapping is writing the program again: a decision changed. */
  writing: boolean;
  /** At the end of the app's header: whether the model that reads typed questions is ready on this device. */
  status?: ReactNode;
  /** Each change of what the person has replied: what the hook's steps wait on. */
  onReplies?: (replies: Replies) => void;
  /** The picked files as locations: what the conversation keeps of them. */
  files: readonly FileReference[];
  /** The program the mapping wrote, `null` until it has: what the preview runs and the build builds. */
  program: string | null;
  /** The preview of `program`, answered in the panel. */
  preview: Preview;
  /** The whole graph's build, `null` until the person asks for it. */
  build: BuildProgress | null;
  /** *Build the graph*, with the transcript to save first: a graph is built from a kept conversation. */
  onBuild: (messages: AssistantMessage[]) => void;
  /** The transcript as it is kept, after each reply of the person's: structure only (`messagesOf`). */
  onSave?: (messages: AssistantMessage[]) => void;
  /** Where a kept conversation stood: the chat starts there. */
  initial?: Replies;
  /** A graph was built from this conversation: it is read as it was built, closed, and never saved. */
  built?: boolean;
}

let written = 0;

/**
 * The assistant (docs/design/assistant.md, *A conversation beside its graph*): the conversation on
 * the left — the assistant's turns as `converse` orders them and the person's replies as their
 * messages — and, once the first message is sent, the panel on the right with what was found
 * (*Data*) and the answers over the first rows (*Preview*), and the actions on the graph. What the
 * hook answers is read here, the person's questions with it; what else they have replied is kept
 * here. The field takes a question at any time; the transcript is kept as its structure
 * (`messagesOf`) after each reply, and a kept one starts the chat where it stood (`initial`).
 */
export function AssistantChat(props: AssistantChatProps) {
  const { onAdvanced, questions, onReplies, onSave } = props;
  const [replies, setReplies] = useState<Replies>(props.initial ?? NO_REPLIES);
  useEffect(() => onReplies?.(replies), [replies, onReplies]);
  // Saving starts with the person's first reply here: a conversation opened and only read is not
  // saved again. One a graph was built from takes no reply at all: it stays as it was built.
  const [replied, setReplied] = useState(false);
  const reply = (next: Partial<Replies>) => {
    if (props.built) return;
    setReplied(true);
    setReplies((prev) => ({ ...prev, ...next }));
  };
  const onChoose = (decision: string, option: string) => {
    if (props.built) return;
    setReplied(true);
    props.onChoose(decision, option);
  };
  const onQuestionsChange = (next: Question[]) => {
    if (props.built) return;
    setReplied(true);
    props.onQuestionsChange(next);
  };

  // The preview has answered once: from then on the conversation is asking the data, and the panel
  // shows the answers.
  const [previewed, setPreviewed] = useState(false);
  const [tab, setTab] = useState<PanelTab>("data");
  const ready = props.preview.state === "ready";
  useEffect(() => {
    if (!ready || previewed) return;
    setPreviewed(true);
    setTab("preview");
  }, [ready, previewed]);

  const conversation = converse({ ...props, previewed }, replies);
  const { turns, waiting } = conversation;
  const closed = conversation.closed || props.built === true;

  // The transcript as it is kept, saved whenever it changes after a reply — but not while the files
  // are read or the model is drafted from them, when the turns after them are not said yet and a save
  // would drop them.
  const messages = messagesOf(turns, { files: props.files, program: props.program });
  const transcript = JSON.stringify(messages);
  const settling =
    waiting === "reading" ||
    (replies.about !== undefined && props.decisions === null);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!replied || settling || transcript === last.current) return;
    last.current = transcript;
    onSave?.(JSON.parse(transcript) as AssistantMessage[]);
  }, [replied, settling, transcript, onSave]);

  // The last typed line that asked the graph to change: answered once, where it was typed, and not kept.
  const [change, setChange] = useState<string | null>(null);
  const ask = (id: string, text: string) => {
    const t = text.trim();
    setChange(null);
    if (!t || questions.some((q) => q.text === t)) return;
    onQuestionsChange([...questions, { id, text: t, answerable: null }]);
    setTab("preview");
  };

  // *Build the graph*: the person's message is part of the transcript, which is saved before the
  // graph is built from it — and so is not saved again by the effect above.
  const buildNow = () => {
    const next = messagesOf(converse({ ...props, previewed }, { ...replies, built: true }).turns, { files: props.files, program: props.program });
    last.current = JSON.stringify(next);
    reply({ built: true });
    props.onBuild(next);
  };

  const open = (props.decisions ?? []).filter(blocks);
  const narrow = useNarrow();
  const [sheet, setSheet] = useState(false);
  const thread = useRef<HTMLUListElement>(null);
  // The build's wait leads to the first decision it waits on — out of the sheet, on a phone.
  const toOpen = () => {
    setSheet(false);
    const id = open[0]?.decision.id;
    const turn = id ? thread.current?.querySelector(`[data-decision="${CSS.escape(id)}"]`) : null;
    turn?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const working = workingOf({
    files: props.selected.size,
    reading: props.reading,
    things: props.understanding.things,
    decisions: props.decisions,
    failures: props.failures,
    program: props.program,
    writing: props.writing,
    preview: props.preview.state,
    build: props.build,
  });

  const draw = (turn: Turn, index: number) => {
    const key = `${turn.kind}-${index}`;
    switch (turn.kind) {
      case "sent":
        return <SentTurn about={turn.about} key={key} sources={turn.sources} />;
      case "understood":
        return <UnderstoodTurn key={key} problems={props.problems} things={props.understanding.things} />;
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
        return <AskTurn key={key} live={!closed} offers={props.offers} onAsk={ask} questions={questions} />;
      case "checkpoint":
        return <CheckpointTurn key={key} />;
      case "asked":
        return (
          <Reply
            key={turn.question.id}
            onRemove={closed ? undefined : () => onQuestionsChange(questions.filter((q) => q.id !== turn.question.id))}
          >
            <span data-question={turn.question.id}>{turn.question.text}</span>
            <Answerable answerable={turn.question.answerable} />
          </Reply>
        );
      case "build-reply":
        return <Reply key={key}>Build the graph</Reply>;
      case "build":
        return <BuildTurn build={props.build} key={key} onBuild={buildNow} questions={questions} />;
    }
  };

  const name = graphName(props.files);
  const sent = replies.about !== undefined;
  const composer = closed ? (
    <ClosedBar name={name} />
  ) : (
    <Composer
      onAsk={(text) => (isChange(text) ? setChange(text.trim()) : ask(`written-${++written}`, text))}
      onPick={props.onPick}
      onDrop={props.onDrop}
      onSend={(text) => reply({ about: text })}
      connections={props.connections}
      list={props.list}
      placeholder={placeholderOf(waiting, previewed)}
      selected={props.selected}
      vocabularies={props.vocabularies}
      waiting={waiting}
    />
  );
  // Nothing sent yet: the question and the composer together in the middle, as Claude opens.
  const empty = !sent && props.failures.length === 0;
  const chat = empty ? (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 pb-[12vh]" data-empty="">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 text-center">
        <h2 className="font-semibold text-2xl tracking-tight">What would you like to explore?</h2>
        <p className="text-muted-foreground">Add files with the +, and say what they are about.</p>
      </div>
      {composer}
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* A turn added takes the pin back, as Conversation's own does; reading back up releases it. */}
      <Conversation>
        <ConversationContent className="py-8">
          <MessageList className="gap-5" ref={thread}>
            {turns.map((turn, index) => draw(turn, index))}
            {change !== null && !closed && (
              <>
                <Reply>{change}</Reply>
                <ChangeTurn
                  onData={() => {
                    setTab("data");
                    if (narrow) setSheet(true);
                  }}
                  text={change}
                />
              </>
            )}
            {props.failures.map((f) => (
              <TaskFailed failure={f} key={f.task} />
            ))}
            {working && <WorkingLine>{working}</WorkingLine>}
          </MessageList>
        </ConversationContent>
        <ConversationScrollButton className="inset-x-auto end-4" />
      </Conversation>

      {composer}
    </div>
  );

  const panel = (
    <AssistantPanel
      done={props.build !== null || props.built === true}
      onBuild={buildNow}
      onEditor={onAdvanced}
      onOpen={toOpen}
      onTab={setTab}
      open={open.length}
      preview={props.preview}
      program={props.program}
      questions={questions}
      relations={props.understanding.relations}
      tab={tab}
      things={props.understanding.things}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <HeaderEnd>{props.status}</HeaderEnd>
      {!sent ? (
        chat
      ) : narrow ? (
        // A phone has no beside: the panel is a sheet over the conversation, opened from a bar.
        <Sheet onOpenChange={(d) => setSheet(d.open)} open={sheet}>
          <SheetTrigger asChild>
            <Button className="mx-3 mt-2 shrink-0 justify-start" variant="outline">
              {barOf(props.understanding.things.length, open.length)}
            </Button>
          </SheetTrigger>
          {chat}
          <SheetContent className="h-[85dvh]" placement="bottom">
            <SheetHeader title="Your graph" />
            <SheetBody className="flex min-h-0 flex-1 flex-col p-0">{panel}</SheetBody>
          </SheetContent>
        </Sheet>
      ) : (
        <Resizable
          className="min-h-0 flex-1"
          defaultSize={[55, 45]}
          panels={[
            { id: "conversation", minSize: 35 },
            { id: "panel", minSize: 25 },
          ]}
        >
          <ResizablePanel className="flex min-w-0 flex-col overflow-hidden" id="conversation">
            {chat}
          </ResizablePanel>
          <ResizableResizeTrigger id="conversation:panel" withHandle />
          <ResizablePanel className="flex min-h-0 min-w-0 flex-col" id="panel">
            <ShellAside aria-label="Your graph" className="size-full min-h-0 border-s-0" side="end">
              {panel}
            </ShellAside>
          </ResizablePanel>
        </Resizable>
      )}
    </div>
  );
}

/** The phone's bar to the panel: *Your graph · 5 kinds · 1 open question*. */
export function barOf(kinds: number, open: number): string {
  const parts = ["Your graph", kinds === 1 ? "1 kind" : `${kinds} kinds`];
  if (open > 0) parts.push(open === 1 ? "1 open question" : `${open} open questions`);
  return parts.join(" · ");
}

/** Narrower than the panel and the conversation fit side by side: below `md`, as the app's own sidebar turns. */
const NARROW = "(max-width: 767px)";
const subscribe = (change: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const useNarrow = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

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
 * The one composer. Sending the first message: the sources are pills above the field and the field
 * says what they are about. After it, the field takes a question about the data at any time — kept,
 * and answered under *Preview* — and is off only while the files are read.
 */
function Composer({
  waiting,
  placeholder,
  connections,
  list,
  selected,
  vocabularies,
  onPick,
  onDrop,
  onSend,
  onAsk,
}: {
  waiting: Waiting;
  placeholder: string;
} & Pick<SourceBarProps, "connections" | "list" | "selected" | "vocabularies" | "onPick" | "onDrop"> & {
    onSend: (about: string) => void;
    onAsk: (text: string) => void;
  }) {
  const [draft, setDraft] = useState("");
  if (waiting === null) return null;
  const first = waiting === "send";
  // The first message needs a source; a question needs words.
  const canSend = first ? selected.size > 0 : waiting === "ask" && draft.trim() !== "";
  const send = () => {
    if (!canSend) return;
    if (first) onSend(draft.trim());
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
        {first && (
          <SourceBar
            connections={connections}
            list={list}
            onDrop={onDrop}
            onPick={onPick}
            selected={selected}
            vocabularies={vocabularies}
          />
        )}
        <PromptInputTextarea
          aria-label={first ? "What is this data about?" : "Your question"}
          className="min-h-14"
          disabled={waiting === "reading"}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={first ? ABOUT_EXAMPLE : placeholder}
          value={draft}
        />
        <PromptInputToolbar className="justify-end">
          <PromptInputSubmit className="ms-0" disabled={!canSend} />
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}
