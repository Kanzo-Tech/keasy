"use client";

import { ArrowRight, Check, CircleHelp, CircleX, Lightbulb, MessageCircleQuestion } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "@kanzo-tech/navigation/next";
import { Checkpoint, CheckpointIcon, Message, MessageContent, Working } from "@kanzo-tech/ai";
import {
  Badge,
  Button,
  Question,
  QuestionChoice,
  QuestionChoices,
  QuestionDescription,
  QuestionPrompt,
  Suggestion,
  Suggestions,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { askHref } from "@/app/(main)/(workspace)/graphs/[id]/discover/_parts/ask-handoff";
import { type SentSource, takenLabel } from "./conversation";
import {
  type BuildProgress,
  type DecisionItem,
  optionOf,
  type Question as AskedQuestion,
  type QuestionOffer,
  type TaskFailure,
  type Thing,
} from "./model";
import { ROWS } from "./preview-tab";
import { listed } from "./tasks/model";

/** The assistant's turn: its words first, then what it carries. */
export function Said({ children, label, decision }: { children: React.ReactNode; label?: string; decision?: string }) {
  return (
    <Message aria-label={label} data-decision={decision} role="assistant">
      <MessageContent className="gap-3">{children}</MessageContent>
    </Message>
  );
}

/**
 * The person's reply: what they sent or wrote, as their message — the files, what it is about, a
 * question. A choice made on a turn's options is not said again here: it stays selected in its turn,
 * which is where it is changed. A question can be removed under it while the questions are asked.
 */
export function Reply({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <Message data-reply="" role="user">
      <MessageContent>{children}</MessageContent>
      {onRemove && (
        <div className="flex basis-full justify-end">
          <Button className="-mt-3 text-muted-foreground text-xs" onClick={onRemove} size="sm" variant="ghost">
            Remove
          </Button>
        </div>
      )}
    </Message>
  );
}

/** A heading inside a turn: what the block under it is. */
function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{children}</h3>;
}

// ── What the person sent, and the work under way ────────────────────────────

/** A connection's chip on the first message: *@Nobel laureates · 6 files*. */
const chipOf = ({ connection, files }: SentSource) => `@${connection} · ${files === 1 ? "1 file" : `${files} files`}`;

/**
 * The first message: the files sent as a chip a connection above what the person said they are about
 * (nothing, when they said nothing). Both travel together, from the composer.
 */
export function SentTurn({ sources, about }: { sources: readonly SentSource[]; about: string }) {
  return (
    <Message data-reply="" role="user">
      <MessageContent className="gap-1.5">
        <span className="flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <Badge key={source.connection} variant="secondary">
              {chipOf(source)}
            </Badge>
          ))}
        </span>
        {about && <span>{about}</span>}
      </MessageContent>
    </Message>
  );
}

/** What the assistant is doing now, at the thread's end: one line, gone when the work is done. */
export function WorkingLine({ children }: { children: string }) {
  return (
    <li data-working="">
      <Working className="text-muted-foreground text-sm">{children}</Working>
    </li>
  );
}

// ── What is in it ───────────────────────────────────────────────────────────

/**
 * What was understood, said in a line: how many kinds of thing, with what each holds beside the
 * conversation, under *Data*. The cards and the counts are the panel's.
 */
export function UnderstoodTurn({ things, problems = [] }: { things: readonly Thing[]; problems?: readonly { id: string; problem: unknown }[] }) {
  return (
    <Said>
      {things.length === 0 ? (
        <p>I could not find anything to read in these files.</p>
      ) : (
        <p>
          I read your files and found {listed(things.map((t) => t.name))}. What each one holds is under{" "}
          <span className="font-medium">Data</span>, beside this.
        </p>
      )}
      {problems.map(({ id, problem }) => (
        <ProblemView error={problem} key={id} />
      ))}
    </Said>
  );
}

// ── Decisions ───────────────────────────────────────────────────────────────

/**
 * A decision as `@kanzo-tech/ui`'s `Question`: its question, and its options to pick one of — never a
 * free answer. An option's `detail` is not drawn: the label is the option.
 */
export function DecisionChoice({
  item,
  description,
  onChoose,
}: {
  item: DecisionItem;
  description?: string;
  onChoose: (option: string) => void;
}) {
  const { decision } = item;
  return (
    <Question
      name={decision.id}
      // One option, never several: the answer is a string.
      onValueChange={(d) => typeof d.value === "string" && d.value && onChoose(d.value)}
      value={optionOf(item)}
    >
      <QuestionPrompt>{decision.question}</QuestionPrompt>
      {description && <QuestionDescription>{description}</QuestionDescription>}
      <QuestionChoices>
        {decision.options.map((option) => (
          <QuestionChoice key={option.id} value={option.id}>
            {option.label}
          </QuestionChoice>
        ))}
      </QuestionChoices>
    </Question>
  );
}

/**
 * A decision with no safe default, as a turn of its own: the question, then its options. It blocks
 * nothing: until it is chosen the graph and the preview read its first option, and the build waits.
 */
export function DecideTurn({
  item,
  index,
  of,
  onChoose,
}: {
  item: DecisionItem;
  index: number;
  of: number;
  onChoose: (option: string) => void;
}) {
  return (
    <Said decision={item.decision.id} label={item.decision.question}>
      {index === 0 && (
        <p className="text-muted-foreground">
          Decisions with no safe answer: {of}. They are yours to decide; until you do, the preview reads the first option, and the
          graph is built once you have.
        </p>
      )}
      <DecisionChoice description={of > 1 ? `Decision ${index + 1} of ${of}` : undefined} item={item} onChoose={onChoose} />
    </Said>
  );
}

/**
 * A default taken without asking, said as what was taken under what was understood — *I assumed:
 * A fraction of the prize · Change* — with its options behind **Change**, the one door to them:
 * picking another is how it changes.
 */
export function AssumedTurn({ item, onChoose }: { item: DecisionItem; onChoose: (option: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = useId();
  return (
    <Said decision={item.decision.id} label={item.decision.question}>
      <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm" data-assumption={item.decision.id}>
        <Lightbulb aria-hidden className="size-4" />
        <span>
          I assumed: <span className="font-semibold text-foreground">{takenLabel(item)}</span>
        </span>
        <Button aria-controls={options} aria-expanded={open} className="h-auto p-0 text-sm" onClick={() => setOpen(!open)} variant="link">
          Change
        </Button>
      </p>
      <div hidden={!open} id={options}>
        {open && <DecisionChoice item={item} onChoose={onChoose} />}
      </div>
    </Said>
  );
}

// ── Questions ───────────────────────────────────────────────────────────────

const ANSWERABLE = {
  yes: { icon: Check, label: "These files can answer it", variant: "success" },
  no: { icon: CircleX, label: "These files cannot answer it", variant: "warning" },
  unknown: { icon: CircleHelp, label: "Not checked yet", variant: "outline" },
} as const;

/** Whether these files can answer a question, as a chip. */
export function Answerable({ answerable }: { answerable: boolean | null }) {
  const { icon: Icon, label, variant } = ANSWERABLE[answerable === null ? "unknown" : answerable ? "yes" : "no"];
  return (
    <Badge className="self-start" variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

/**
 * "What would you like to know?" — the questions on offer as chips, while the conversation is open.
 * The field under the conversation takes the person's own at any time.
 */
export function AskTurn({
  offers,
  questions,
  live,
  onAsk,
}: {
  offers: readonly QuestionOffer[] | null;
  questions: readonly AskedQuestion[];
  live: boolean;
  onAsk: (id: string, text: string) => void;
}) {
  const kept = new Set(questions.map((q) => q.text));
  const open = (offers ?? []).filter((o) => !kept.has(o.text));
  return (
    <Said>
      <p className="font-medium text-base">What would you like to know?</p>
      <p className="text-muted-foreground">
        {live && (offers === null || open.length > 0) ? "Take one of these, or ask your own below" : "Ask your own below"}. I&rsquo;ll answer
        each one under <span className="font-medium">Preview</span>, over the first {ROWS} rows.
      </p>
      {live && (offers === null || open.length > 0) && (
        <Suggestions pending={offers === null ? 3 : 0}>
          {open.map((o) => (
            <Suggestion description={o.rationale} key={o.id} onSelect={(text) => onAsk(o.id, text)} value={o.text} />
          ))}
        </Suggestions>
      )}
    </Said>
  );
}

/**
 * The checkpoint: the preview has answers, and from here the person is asking their data. A marker
 * in the thread — `@kanzo-tech/ai`'s `Checkpoint` with no way back, since it is not a state to return to.
 */
export function CheckpointTurn() {
  return (
    <Checkpoint data-checkpoint="">
      <CheckpointIcon />
      Your data is ready to ask · first {ROWS} rows
    </Checkpoint>
  );
}

// ── The graph ───────────────────────────────────────────────────────────────

/**
 * The whole graph, once the person asked for it from the panel (`useBuild`): under way, the working
 * line says so; failed, its problem and a retry; done, a tinted panel — **Ask your data** as the
 * primary action, **Open the graph**, and the person's questions to take to Discover.
 */
export function BuildTurn({
  build,
  onBuild,
  questions,
}: {
  build: BuildProgress | null;
  onBuild: () => void;
  questions: readonly AskedQuestion[];
}) {
  if (build === null) return null;
  switch (build.state) {
    case "building":
      return null;
    case "failed":
      return (
        <Said>
          <p>I could not build your graph.</p>
          <ProblemView error={build.problem} onRetry={onBuild} />
        </Said>
      );
    case "done":
      return (
        <section className="flex flex-col gap-3 rounded-box border border-success/30 bg-success/7 p-4" data-built-panel="">
          <p className="font-semibold text-base">Your graph is ready to explore.</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href={askHref(build.graphId)}>
                <MessageCircleQuestion />
                Ask your data
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href={`/graphs/${build.graphId}`}>Open the graph</Link>
            </Button>
          </div>
          {questions.length > 0 && (
            <section className="flex flex-col gap-2 pt-1">
              <Label>Start from your questions</Label>
              <ul className="flex flex-col gap-1.5">
                {questions.map((q) => (
                  <li key={q.id}>
                    <Button asChild className="h-auto w-full justify-start py-2 text-start whitespace-normal" variant="outline">
                      <Link href={askHref(build.graphId, q.text)}>
                        <span className="flex-1">{q.text}</span>
                        <ArrowRight className="text-muted-foreground" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      );
  }
}

/**
 * The reply to typed text that changes the graph: it is not taken as an instruction, and says where
 * that is changed — what each kind of thing holds and is called is under *Data*.
 */
export function ChangeTurn({ text, onData }: { text: string; onData: () => void }) {
  return (
    <Said>
      <p data-change="">
        &ldquo;{text}&rdquo; changes your graph rather than asking your data, so I have not taken it as a question. What
        each kind of thing is called and holds is under{" "}
        <Button className="h-auto p-0 text-base" onClick={onData} variant="link">
          Data
        </Button>
        ; the questions here are answered under <span className="font-medium">Preview</span>.
      </p>
    </Said>
  );
}

const FAILED: Record<TaskFailure["task"], string> = {
  mapping: "I could not write how these files become your graph.",
};

/** A step that failed, said where the conversation stopped, with the way to try again. */
export function TaskFailed({ failure }: { failure: TaskFailure }) {
  return (
    <Said>
      <p data-task={failure.task}>{FAILED[failure.task]}</p>
      <ProblemView error={failure.problem} onRetry={failure.retry} />
    </Said>
  );
}
