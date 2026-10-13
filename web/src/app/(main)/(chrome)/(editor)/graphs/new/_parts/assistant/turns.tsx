"use client";

import { ArrowRight, Check, CircleCheck, CircleHelp, CircleX, Hammer, Lightbulb, MessageCircleQuestion, Sparkles } from "lucide-react";
import { Link } from "@kanzo-tech/navigation/next";
import { Message, MessageContent } from "@kanzo-tech/ai";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  RadioGroup,
  RadioGroupCard,
  RadioGroupIndicator,
  RadioGroupText,
  Spinner,
  StatDescription,
  StatLabel,
  StatRoot,
  StatValue,
  Suggestion,
  Suggestions,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { askHref } from "@/app/(main)/(workspace)/graphs/[id]/discover/_parts/ask-handoff";
import { takenLabel } from "./conversation";
import { holdsLine, inWords } from "./tasks/words";
import {
  type BuildProgress,
  type DecisionItem,
  optionOf,
  type Question,
  type QuestionOffer,
  type ReadingProgress,
  type Relation,
  type TaskFailure,
  type Thing,
} from "./model";
import { SourcePicker, type SourcePickerProps } from "./source-picker";

const count = new Intl.NumberFormat("en");

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

// ── Which data ──────────────────────────────────────────────────────────────

export interface PickTurnProps extends SourcePickerProps {
  /** Still waiting on the pick: the tree is drawn, with the reply under it. */
  live: boolean;
  onPicked: () => void;
  /** Why the reply cannot be sent yet, beside it. */
  reason: string | null;
}

/** "Which data do you want to explore?" — the files as a tree, and *Read these files* as the reply. */
export function PickTurn({ live, onPicked, reason, ...picker }: PickTurnProps) {
  const picked = picker.selected.size;
  return (
    <Said>
      <p className="font-medium text-base">Which data do you want to explore?</p>
      {live && (
        <>
          <p className="text-muted-foreground">
            Pick the files to read. A folder&rsquo;s box picks every file in it.
          </p>
          <div className="overflow-hidden rounded-box border bg-card shadow-xs/5">
            <div className="max-h-96 overflow-auto p-1.5">
              <SourcePicker {...picker} />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t bg-muted/40 px-3 py-2.5">
              <span className="me-auto text-muted-foreground text-xs" id="pick-status">
                {reason ?? (picked === 1 ? "One file picked" : `${picked} files picked`)}
              </span>
              {/* Off, it stops looking like the way on: the primary fill at 64% still reads as one. */}
              <Button
                aria-describedby="pick-status"
                disabled={reason !== null}
                onClick={onPicked}
                size="sm"
                variant={reason === null ? "default" : "secondary"}
              >
                Read {picked === 1 ? "this file" : "these files"}
                <ArrowRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </Said>
  );
}

/** Work under way, as a status: its words beside a spinner, and its bar — indeterminate without a value. */
function Working({ label, children, value }: { label: string; children: React.ReactNode; value?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Spinner aria-hidden />
        {children}
      </span>
      <Progress aria-label={label} className="max-w-xs" indeterminate={value === undefined} value={value} />
    </div>
  );
}

/** "Reading your files… 4 of 6", live, with its bar; "Read 6 files" once it is done. */
export function ReadingTurn({
  reading,
  total,
  problems,
}: {
  reading: ReadingProgress | null;
  total: number;
  problems: readonly { id: string; problem: unknown }[];
}) {
  return (
    <Said>
      {reading === null ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <CircleCheck aria-hidden className="size-4 text-success-foreground" />
          Read {total === 1 ? "the file" : `all ${total} files`}.
        </p>
      ) : (
        <Working label="Reading your files" value={(reading.done / reading.total) * 100}>
          Reading your files… {reading.done} of {reading.total}
        </Working>
      )}
      {problems.map(({ id, problem }) => (
        <ProblemView error={problem} key={id} />
      ))}
    </Said>
  );
}

/**
 * "While I read them: what is it about?" — optional, answered or skipped in the composer. Once it is,
 * the composer is gone, and so is the line about how to answer.
 */
export function AboutTurn({ live }: { live: boolean }) {
  return (
    <Said>
      <p>
        While I read them: <span className="font-medium">what is this data about?</span>
      </p>
      {live && (
        <p className="text-muted-foreground">A sentence is enough, and it is optional. It helps me read the files the way you mean them.</p>
      )}
    </Said>
  );
}

// ── What is in it ───────────────────────────────────────────────────────────

/** One thing as a stat: its name, how many, and what each one holds. */
function ThingCard({ thing }: { thing: Thing }) {
  const holds = holdsLine(thing.holds);
  return (
    <StatRoot className="w-full content-start gap-y-0.5 py-3" data-thing={thing.id}>
      <StatLabel className="text-foreground">{thing.name}</StatLabel>
      {thing.count === null ? (
        <span className="col-span-full pt-1 text-muted-foreground text-xs">Not counted yet</span>
      ) : (
        <StatValue className="pt-1 text-xl">{count.format(thing.count)}</StatValue>
      )}
      {holds && <StatDescription className="col-span-full pt-1 text-xs">Each one holds {holds}.</StatDescription>}
    </StatRoot>
  );
}

/** A relation as its sentence, with one real row of it as a chip. */
function RelationLine({ relation }: { relation: Relation }) {
  return (
    <li className="flex flex-col items-start gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <span>{relation.sentence}</span>
      {relation.example && (
        <Badge className="max-w-full font-normal text-muted-foreground" variant="outline">
          <span className="text-muted-foreground/80">e.g.</span>
          <span className="truncate text-foreground">{relation.example.join(" · ")}</span>
        </Badge>
      )}
    </li>
  );
}

/** "Here's what's in your data:" — the things with their counts, and how they hang together. */
export function UnderstoodTurn({ things, relations }: { things: readonly Thing[]; relations: readonly Relation[] | null }) {
  if (things.length === 0) {
    return (
      <Said>
        <p>I could not find anything to read in these files.</p>
      </Said>
    );
  }
  return (
    <Said>
      <p>
        Here&rsquo;s what&rsquo;s in your data: <span className="font-medium">{inWords(things.length, "kind of thing", "kinds of things")}</span>.
      </p>
      {/* Rows that fill: three to a row in the column, the last row's cards widened to close it, and one
          to a row on a phone — never a card alone beside a hole. */}
      <ul className="flex flex-wrap gap-2" data-things="">
        {things.map((thing) => (
          <li className="flex flex-1 basis-56" key={thing.id}>
            <ThingCard thing={thing} />
          </li>
        ))}
      </ul>
      {relations && relations.length > 0 && (
        <section className="flex flex-col gap-2 pt-2">
          <Label>How it fits together</Label>
          <ul className="flex flex-col divide-y">
            {relations.map((r) => (
              <RelationLine key={r.id} relation={r} />
            ))}
          </ul>
        </section>
      )}
    </Said>
  );
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** A decision as its options, each a card with its radio before its label — never a free answer. */
export function DecisionChoice({ item, onChoose }: { item: DecisionItem; onChoose: (option: string) => void }) {
  const { decision } = item;
  return (
    <RadioGroup
      aria-label={decision.question}
      className="gap-2"
      onValueChange={(d) => d.value && onChoose(d.value)}
      value={optionOf(item)}
    >
      {decision.options.map((option) => (
        <RadioGroupCard className="items-start gap-3" key={option.id} value={option.id}>
          <RadioGroupIndicator className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <RadioGroupText>{option.label}</RadioGroupText>
            {option.detail && <span className="text-muted-foreground text-xs">{option.detail}</span>}
          </div>
        </RadioGroupCard>
      ))}
    </RadioGroup>
  );
}

/** A decision with no safe default, as a turn of its own: the question, then its options. */
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
          {of === 1 ? "One thing has no safe answer, so it is yours to decide." : `${inWords(of, "thing")} have no safe answer, so they are yours to decide.`}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {of > 1 && <Label>{`Decision ${index + 1} of ${of}`}</Label>}
        <p className="font-medium text-base">{item.decision.question}</p>
      </div>
      <DecisionChoice item={item} onChoose={onChoose} />
    </Said>
  );
}

/**
 * A default taken without asking, said as what was taken — *I assumed: A fraction of the prize* —
 * with the question it answers, and its options under it as a decision's are, the one taken selected:
 * picking another is how it changes. It blocks nothing.
 */
export function AssumedTurn({ item, onChoose }: { item: DecisionItem; onChoose: (option: string) => void }) {
  return (
    <Said decision={item.decision.id} label={item.decision.question}>
      <Alert data-assumption={item.decision.id}>
        <Lightbulb aria-hidden />
        <AlertTitle>
          I assumed: <span className="font-semibold">{takenLabel(item)}</span>
        </AlertTitle>
        <AlertDescription>{item.decision.question}</AlertDescription>
      </Alert>
      <DecisionChoice item={item} onChoose={onChoose} />
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
 * "What would you like to know?" — the questions on offer as chips, and the composer for one's own,
 * while the questions are asked; after, only what the questions under it are.
 */
export function AskTurn({
  offers,
  questions,
  live,
  onAsk,
}: {
  offers: readonly QuestionOffer[] | null;
  questions: readonly Question[];
  live: boolean;
  onAsk: (id: string, text: string) => void;
}) {
  const kept = new Set(questions.map((q) => q.text));
  const open = (offers ?? []).filter((o) => !kept.has(o.text));
  return (
    <Said>
      <p className="font-medium text-base">What would you like to know?</p>
      {live ? (
        <p className="text-muted-foreground">
          {open.length > 0 ? "Take one of these, or write your own below" : "Write your questions below"}. I&rsquo;ll
          check whether these files can answer each one.
        </p>
      ) : (
        questions.length > 0 && (
          <p className="text-muted-foreground">
            {questions.length === 1 ? "Your question, and whether" : "Your questions, and whether"} these files can answer{" "}
            {questions.length === 1 ? "it" : "each one"}:
          </p>
        )
      )}
      {live && open.length > 0 && (
        <Suggestions>
          {open.map((o) => (
            <Suggestion description={o.rationale} key={o.id} onSelect={(text) => onAsk(o.id, text)} value={o.text} />
          ))}
        </Suggestions>
      )}
    </Said>
  );
}

/** The way on from the questions, under them: the preview answers what was asked. */
export function AskDone({ questions, onDone }: { questions: number; onDone: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onDone} size="sm" variant={questions === 0 ? "outline" : "default"}>
        {questions === 0 ? "Skip, show me a preview" : "That's all, show me a preview"}
        <ArrowRight />
      </Button>
    </div>
  );
}

// ── The graph ───────────────────────────────────────────────────────────────

/**
 * *Build the whole graph*, on request, once the preview has been seen: every row of every file, as a
 * graph of its own (`useBuild`). Then its progress, and once it is done the hand-off — **Ask your
 * data** as the one primary action, and the person's questions as prompts to take to Discover.
 */
export function BuildTurn({
  build,
  ready,
  onBuild,
  questions,
}: {
  build: BuildProgress | null;
  /** There is a program to build: the mapping has written it. */
  ready: boolean;
  onBuild: () => void;
  questions: readonly Question[];
}) {
  if (build === null) {
    return (
      <Said>
        <p className="text-muted-foreground">
          {questions.length > 0 ? "When the answers look right" : "When you are ready"}, I&rsquo;ll build the whole graph:
          every row of every file, kept to come back to.
        </p>
        <Button className="self-start" disabled={!ready} onClick={onBuild} size="lg">
          <Hammer />
          Build the whole graph
        </Button>
      </Said>
    );
  }
  switch (build.state) {
    case "building": {
      const percent = build.percent === null ? null : Math.round(build.percent);
      return (
        <Said>
          <Working label="Building your graph" value={percent ?? undefined}>
            {build.graphId === null ? "Making your graph…" : `Building your graph${percent === null ? "…" : `… ${percent}%`}`}
          </Working>
        </Said>
      );
    }
    case "failed":
      return (
        <Said>
          <p>I could not build your graph.</p>
          <ProblemView error={build.problem} onRetry={onBuild} />
        </Said>
      );
    case "done":
      return (
        <Said>
          <p className="flex items-center gap-2 font-medium text-base">
            <Sparkles aria-hidden className="size-4 text-primary" />
            Your graph is ready to explore.
          </p>
          <Button asChild className="self-start" size="lg">
            <Link href={askHref(build.graphId)}>
              <MessageCircleQuestion />
              Ask your data
            </Link>
          </Button>
          {questions.length > 0 && (
            <section className="flex flex-col gap-2 pt-1">
              <Label>Start from your questions</Label>
              <ul className="flex flex-col gap-1.5">
                {questions.map((q) => (
                  <li key={q.id}>
                    <Button asChild className="h-auto w-full justify-start py-2 text-start whitespace-normal" variant="outline">
                      <Link href={askHref(build.graphId, q.text)}>
                        <MessageCircleQuestion className="text-muted-foreground" />
                        <span className="flex-1">{q.text}</span>
                        <ArrowRight className="text-muted-foreground" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </Said>
      );
  }
}

const FAILED: Record<TaskFailure["task"], string> = {
  model: "I could not make sense of these files.",
  requirements: "I could not suggest questions for these files.",
  mapping: "I could not write how these files become your graph.",
};

/** A Task that failed, said where the conversation stopped, with the way to ask again. */
export function TaskFailed({ failure }: { failure: TaskFailure }) {
  return (
    <Said>
      <p data-task={failure.task}>{FAILED[failure.task]}</p>
      <ProblemView error={failure.problem} onRetry={failure.retry} uncoded="llm/failed" />
    </Said>
  );
}
