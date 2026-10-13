"use client";

import { Check, CircleHelp, X } from "lucide-react";
import { Badge, RadioGroup, RadioGroupCard, RadioGroupIndicator, RadioGroupText, Show, Spinner } from "@kanzo-tech/ui";
import { type DecisionItem, optionOf, type Question, type Relation, type Thing, type Understanding } from "./model";

const count = new Intl.NumberFormat();

/** The things found, each with its count: Laureates · 1,018. */
function Things({ things }: { things: readonly Thing[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {things.map((thing) => (
        <li className="flex flex-col gap-0.5" key={thing.id}>
          <span className="font-medium text-sm">
            {thing.name}
            {thing.count !== null && <span className="text-muted-foreground"> · {count.format(thing.count)}</span>}
          </span>
          <Show when={thing.holds.length > 0}>
            <span className="text-muted-foreground text-xs">Each one holds {thing.holds.join(", ")}.</span>
          </Show>
        </li>
      ))}
    </ul>
  );
}

/** How they hang together: a sentence, and one real row of it. */
function Relations({ relations }: { relations: readonly Relation[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {relations.map((r) => (
        <li className="flex flex-col gap-0.5 text-sm" key={r.id}>
          {r.sentence}
          {r.example && <span className="text-muted-foreground text-xs">e.g. {r.example.join(" · ")}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A decision as its options, each with its detail — never a free answer. */
export function DecisionChoice({ item, onChoose }: { item: DecisionItem; onChoose: (option: string) => void }) {
  const { decision } = item;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm">{decision.question}</legend>
      <RadioGroup
        aria-label={decision.question}
        onValueChange={(d) => d.value && onChoose(d.value)}
        value={optionOf(item)}
      >
        {decision.options.map((option) => (
          <RadioGroupCard className="items-start" key={option.id} value={option.id}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <RadioGroupText>{option.label}</RadioGroupText>
              {option.detail && <span className="text-muted-foreground text-xs">{option.detail}</span>}
            </div>
            <RadioGroupIndicator className="order-last ms-auto mt-0.5" />
          </RadioGroupCard>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/** A default taken without asking: said, with what it took, and changeable — never in the way. */
export function Assumption({ item, onChange }: { item: DecisionItem; onChange?: () => void }) {
  const taken = item.decision.options.find((o) => o.id === optionOf(item));
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-sm" data-assumption={item.decision.id}>
      <span className="text-muted-foreground">{item.decision.question}</span>
      <span>{taken?.label}</span>
      {onChange && (
        <button className="text-primary text-xs underline-offset-2 hover:underline" onClick={onChange} type="button">
          Change
        </button>
      )}
    </li>
  );
}

const ANSWERABLE = {
  yes: { icon: Check, label: "These files can answer it" },
  no: { icon: X, label: "These files cannot answer it" },
  unknown: { icon: CircleHelp, label: "Not checked yet" },
} as const;

function Questions({ questions }: { questions: readonly Question[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {questions.map((q) => {
        const { icon: Icon, label } = ANSWERABLE[q.answerable === null ? "unknown" : q.answerable ? "yes" : "no"];
        return (
          <li className="flex items-center justify-between gap-2 text-sm" key={q.id}>
            {q.text}
            <Badge size="xs" variant={q.answerable === false ? "outline" : "secondary"}>
              <Icon aria-hidden />
              {label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

export interface UnderstoodScreenProps {
  understanding: Understanding;
  /** `null` until something raises them. */
  decisions: readonly DecisionItem[] | null;
  onChoose: (decision: string, option: string) => void;
  questions: readonly Question[];
  /** The rows the preview is being prepared over, while it is. */
  preparing: number | null;
}

/**
 * Screen 2, *What I understood*: the things in the data with their counts, how they hang together
 * with a real row, the decisions that have no safe answer as choices, the ones that had one as
 * assumptions, and whether the person's questions can be answered.
 */
export function UnderstoodScreen({ understanding, decisions, onChoose, questions, preparing }: UnderstoodScreenProps) {
  const { things, relations } = understanding;
  const open = (decisions ?? []).filter((d) => d.assumed === null);
  const assumed = (decisions ?? []).filter((d) => d.assumed !== null);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">In your data</h2>
        <Show fallback={<p className="text-muted-foreground text-sm">Nothing read yet.</p>} when={things.length > 0}>
          <Things things={things} />
        </Show>
      </section>

      <Show when={relations !== null && relations.length > 0}>
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">How it fits together</h2>
          {relations && <Relations relations={relations} />}
        </section>
      </Show>

      <Show when={open.length > 0}>
        <section className="flex flex-col gap-4">
          <h2 className="font-medium text-sm">One thing to decide</h2>
          {open.map((item) => (
            <DecisionChoice item={item} key={item.decision.id} onChoose={(option) => onChoose(item.decision.id, option)} />
          ))}
        </section>
      </Show>

      <Show when={assumed.length > 0}>
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">Assumed</h2>
          <p className="text-muted-foreground text-xs">Taken for you; change any of them later, from Explore.</p>
          <ul className="flex flex-col gap-1">
            {assumed.map((item) => (
              <Assumption item={item} key={item.decision.id} />
            ))}
          </ul>
        </section>
      </Show>

      <Show when={questions.length > 0}>
        <section className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">Your questions</h2>
          <Questions questions={questions} />
        </section>
      </Show>

      <Show when={preparing !== null}>
        <p aria-live="polite" className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
          <Spinner aria-hidden />
          Preparing a preview with {preparing} rows…
        </p>
      </Show>
    </div>
  );
}
