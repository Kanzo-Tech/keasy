"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Assist, AssistProvider } from "@kanzo-tech/ai";
import type { LanguageModel } from "@kanzo-tech/llm";
import {
  Button,
  Field,
  FieldHelper,
  FieldLabel,
  FieldRequiredIndicator,
  Input,
  Show,
  Spinner,
  Suggestion,
  Suggestions,
  Textarea,
} from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { toastError } from "@/lib/errors";
import type { Question, QuestionOffer, ReadingProgress } from "./model";
import { SourcePicker, type SourcePickerProps } from "./source-picker";

/** "Reading the files… 4 of 6": how far the picked files have been read. */
export function ReadingLine({ reading }: { reading: ReadingProgress }) {
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
      <Spinner aria-hidden />
      Reading the files… {reading.done} of {reading.total}
    </p>
  );
}

/** The model "What is it about?" is assisted by, and what it is told of the picked files. */
export interface AboutAssist {
  model: LanguageModel;
  context: () => string;
}

export interface DataScreenProps extends SourcePickerProps {
  about: string;
  onAboutChange: (about: string) => void;
  /** `null` while there is no model: the field is a plain one, with no ghost text. */
  assist: AboutAssist | null;
  /** Questions on offer as chips, `null` while nothing offers them. */
  offers: readonly QuestionOffer[] | null;
  questions: readonly Question[];
  onQuestionsChange: (questions: Question[]) => void;
  reading: ReadingProgress | null;
  problems: readonly { id: string; problem: unknown }[];
}

const ABOUT_EXAMPLE = "e.g. Nobel prizes and the people who won them";

/** Screen 1, *Your data*: the files, what they are about, and what the person wants to know. */
export function DataScreen(props: DataScreenProps) {
  const { about, onAboutChange, assist, offers, questions, onQuestionsChange, reading, problems } = props;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">Pick the files to read</h2>
        <SourcePicker {...props} />
        <Show when={reading !== null}>{reading && <ReadingLine reading={reading} />}</Show>
        {problems.map(({ id, problem }) => (
          <ProblemView error={problem} key={id} />
        ))}
      </section>

      <Field>
        <FieldLabel>
          What is it about?
          <FieldRequiredIndicator fallback="(optional)" />
        </FieldLabel>
        {assist ? (
          <AssistProvider
            context={assist.context}
            model={assist.model}
            onFailure={(error) => toastError(error, "The suggestion failed")}
          >
            <Assist onValueChange={onAboutChange} value={about}>
              <Textarea placeholder={ABOUT_EXAMPLE} rows={3} />
            </Assist>
          </AssistProvider>
        ) : (
          <Textarea
            onChange={(e) => onAboutChange(e.target.value)}
            placeholder={ABOUT_EXAMPLE}
            rows={3}
            value={about}
          />
        )}
        <FieldHelper>A sentence is enough. It helps read the files the way you mean them.</FieldHelper>
      </Field>

      <QuestionsField offers={offers} onQuestionsChange={onQuestionsChange} questions={questions} />
    </div>
  );
}

let written = 0;

/** "What would you like to know?": offers as chips, the kept ones above them, and one's own. */
export function QuestionsField({
  offers,
  questions,
  onQuestionsChange,
}: Pick<DataScreenProps, "offers" | "questions" | "onQuestionsChange">) {
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const kept = new Set(questions.map((q) => q.text));
  const add = (id: string, text: string) => {
    const t = text.trim();
    if (!t || kept.has(t)) return;
    onQuestionsChange([...questions, { id, text: t, answerable: null }]);
  };
  const write = () => {
    add(`written-${++written}`, draft);
    setDraft("");
    setWriting(false);
  };
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">
        What would you like to know? <span className="font-normal text-muted-foreground">(optional)</span>
      </h2>
      <Show when={questions.length > 0}>
        <ul className="flex flex-col gap-1">
          {questions.map((q) => (
            <li className="flex items-center justify-between gap-2 text-sm" key={q.id}>
              {q.text}
              <Button
                aria-label={`Remove “${q.text}”`}
                onClick={() => onQuestionsChange(questions.filter((other) => other.id !== q.id))}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      </Show>
      <Suggestions>
        {(offers ?? [])
          .filter((o) => !kept.has(o.text))
          .map((o) => (
            <Suggestion description={o.rationale} key={o.id} onSelect={(text) => add(o.id, text)} value={o.text} />
          ))}
        <Show when={!writing}>
          <Button onClick={() => setWriting(true)} size="sm" variant="outline">
            <Plus />
            Write one
          </Button>
        </Show>
      </Suggestions>
      <Show when={writing}>
        <Input
          aria-label="Your question"
          autoFocus
          onBlur={() => (draft.trim() ? write() : setWriting(false))}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") write();
            if (e.key === "Escape") setWriting(false);
          }}
          placeholder="e.g. Which country has the most laureates?"
          value={draft}
        />
      </Show>
    </section>
  );
}
