"use client";

import { ArrowRight, Check, CircleHelp, CircleX, ExternalLink, Lightbulb, MessageCircleQuestion } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "@kanzo-tech/navigation/next";
import { Message, MessageContent } from "@kanzo-tech/ai";
import { splitWords } from "@kanzo-tech/mosaic";
import {
  Badge,
  Button,
  Question,
  QuestionChoice,
  QuestionChoices,
  QuestionDescription,
  QuestionPrompt,
  StatDescription,
  StatLabel,
  StatRoot,
  StatValue,
  Suggestion,
  Suggestions,
  FormatNumber,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { askHref } from "@/app/(main)/(workspace)/graphs/[id]/discover/_parts/ask-handoff";
import { type SentSource, takenLabel } from "./conversation";
import type { Step } from "./steps";
import { listed } from "./tasks/model";
import {
  type BuildProgress,
  type DecisionItem,
  optionOf,
  type Question as AskedQuestion,
  type QuestionOffer,
  type Relation,
  type TaskFailure,
  type Thing,
} from "./model";
import { ChainOfThought, ChainOfThoughtStep } from "./chain-of-thought";


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

// ── What the person sent, and the steps ─────────────────────────────────────

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

/**
 * *What I am doing*: a list of steps, each done, under way, waiting on the person or still to come,
 * so what the assistant has done and what is left are read in one place. **Open in the editor** is an
 * action on the step that wrote the program, and what a step stopped on is said under the list.
 */
export function StepsTurn({
  steps,
  onEditor,
  problems = [],
}: {
  steps: readonly Step[];
  onEditor: () => void;
  problems?: readonly { id: string; problem: unknown }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <ChainOfThought aria-label="What I am doing">
        {steps.map((step) => (
          <ChainOfThoughtStep
            description={step.description}
            icon={step.failed ? CircleX : undefined}
            key={step.id}
            label={step.label}
            status={step.status}
          >
            {step.action === "editor" && (
              <Button className="h-auto p-0 font-normal text-sm" onClick={onEditor} title="Write the shapes and the program yourself" variant="link">
                Open in the editor
                <ExternalLink aria-hidden className="size-3.5" />
              </Button>
            )}
          </ChainOfThoughtStep>
        ))}
      </ChainOfThought>
      {problems.map(({ id, problem }) => (
        <ProblemView error={problem} key={id} />
      ))}
    </div>
  );
}

// ── What is in it ───────────────────────────────────────────────────────────

/**
 * What each one of a thing holds, from its columns: "name, gender, birth date and 4 more". Column
 * names are the data's own words, so they are said (`birth_date` → "birth date", by mosaic's `splitWords`) and not renamed.
 */
export function holdsLine(holds: readonly string[], shown = 4): string | null {
  if (holds.length === 0) return null;
  const words = holds.map(splitWords);
  if (words.length <= shown + 1) return listed(words);
  return `${words.slice(0, shown).join(", ")} and ${words.length - shown} more`;
}

/** One thing as a stat: its name, how many, and what each one holds. */
function ThingCard({ thing }: { thing: Thing }) {
  const holds = holdsLine(thing.holds);
  return (
    <StatRoot className="w-full content-start gap-y-0.5 py-3" data-thing={thing.id}>
      <StatLabel className="text-foreground">{thing.name}</StatLabel>
      {thing.count === null ? (
        <span className="col-span-full pt-1 text-muted-foreground text-xs">Not counted yet</span>
      ) : (
        <StatValue className="pt-1 text-xl"><FormatNumber value={thing.count} /></StatValue>
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
        Here&rsquo;s what&rsquo;s in your data. Kinds of thing: <span className="font-medium">{things.length}</span>.
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
          Decisions with no safe answer: {of}. They are yours to decide.
        </p>
      )}
      <DecisionChoice description={of > 1 ? `Decision ${index + 1} of ${of}` : undefined} item={item} onChoose={onChoose} />
    </Said>
  );
}

/**
 * A default taken without asking, said as what was taken under what was understood — *I assumed:
 * A fraction of the prize · Change* — with its options behind **Change**, the one door to them:
 * picking another is how it changes. It blocks nothing.
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
  questions: readonly AskedQuestion[];
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
          {offers === null || open.length > 0 ? "Take one of these, or write your own below" : "Write your questions below"}. I&rsquo;ll
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
 * The way on from the questions, under them: the preview answers what was asked. At the start, as
 * every turn's action is — the end is where the log's scroll button floats.
 */
export function AskDone({ questions, onDone }: { questions: number; onDone: () => void }) {
  return (
    <div className="flex">
      <Button onClick={onDone} size="sm" variant={questions === 0 ? "outline" : "default"}>
        {questions === 0 ? "Skip, show me a preview" : "That's all, show me a preview"}
        <ArrowRight />
      </Button>
    </div>
  );
}

// ── The graph ───────────────────────────────────────────────────────────────

/**
 * *Build the graph*, on request, once the preview has been seen: every row of every file, as a graph
 * of its own (`useBuild`). Its progress is the steps' (`StepsTurn`); once it is done, a tinted panel —
 * **Ask your data** as the primary action, **Open the graph**, and the person's questions to take to
 * Discover.
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
  questions: readonly AskedQuestion[];
}) {
  if (build === null) {
    return (
      <section className="flex flex-col gap-3 border-t pt-4">
        <p>
          {questions.length > 0 ? "When the answers look right" : "When you are ready"}, I&rsquo;ll build the whole graph: every row of
          every file. This conversation is kept with it.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button disabled={!ready} onClick={onBuild} size="lg">
            Build the graph
          </Button>
          <span className="text-muted-foreground text-sm">or change a decision above, and the preview runs again</span>
        </div>
      </section>
    );
  }
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
