"use client";

import type { ComponentProps } from "react";
import type { ChatDataRenderers } from "@kanzo-tech/ai";
import { AnswerCard, askEdit, AskChips, type AskMessage, type AskOutput, type AskTurn } from "@kanzo-tech/ai/data";
import type { JoinGraph } from "@kanzo-tech/relations";
import { Question, QuestionChoice, QuestionChoices, QuestionPrompt } from "@kanzo-tech/ui";
import { describeProblem } from "@/components/problem-view";

/** *Add to the dashboard* and *Open on the dashboard*, where the page has a dashboard to add to. */
type Adding = Pick<ComponentProps<typeof AnswerCard>, "dashboards" | "onAdd" | "onOpen">;

/**
 * How keasy draws Ask's parts, for `Chat`'s `data` renderers and for a transcript drawn by hand (the
 * assistant's preview): a `data-answer` as the `AnswerCard` it is, with its `AskChips` once it is read
 * — taking a chip asks the edited spec, no model — and a `data-ask` that holds a decision as
 * `@kanzo-tech/ui`'s `Question`, its pick sent back as `askEdit(spec, { [decision]: option })`. A
 * person's own `data-ask` part, an edit or a pick, draws nothing: their message says it.
 */
export function askParts({
  graph,
  send,
  adding,
}: {
  graph: JoinGraph;
  send: (message: Pick<AskMessage, "parts">) => void;
  adding?: Adding;
}): ChatDataRenderers {
  return {
    answer: (part, { stopped }) => {
      const output = part.data as AskOutput;
      return (
        <div className="flex flex-col gap-2">
          <AnswerCard answer={output} describe={describeProblem} graph={graph} stopped={stopped} {...(adding as object)} />
          {output.rows !== undefined && <AskChips onChange={(next) => send(askEdit(next))} over={{ graph }} spec={output.spec} />}
        </div>
      );
    },
    ask: (part) => {
      const { spec, decision } = part.data as AskTurn;
      if (!decision) return null;
      return (
        <Question
          name={decision.id}
          // One option, never several: the answer is a string.
          onValueChange={(d) => typeof d.value === "string" && d.value && send(askEdit(spec, { [decision.id]: d.value }))}
          value={null}
        >
          <QuestionPrompt>{decision.question}</QuestionPrompt>
          <QuestionChoices>
            {decision.options.map((option) => (
              <QuestionChoice key={option.id} value={option.id}>
                {option.label}
              </QuestionChoice>
            ))}
          </QuestionChoices>
        </Question>
      );
    },
  };
}
