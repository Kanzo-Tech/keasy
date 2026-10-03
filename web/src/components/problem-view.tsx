"use client";

import type { ReactNode } from "react";
import { Button, DiagnosticList, Problem, type ProblemCopy } from "@kanzo-tech/ui";
import { type ClientCode, coded, copyOf, pageOf } from "@/lib/errors";

/** keasy's words for a code, and the page that explains it when fossil raised it. */
const copy = (code: string, data: unknown): ProblemCopy => ({ ...copyOf(code, data), page: pageOf(code) });

export interface ProblemItemProps {
  /** What was thrown, or a problem as stored. */
  error: unknown;
  /** The code a failure that carries none is shown under. */
  uncoded?: ClientCode;
  /** Beside the problem's own link and details: a retry, a "go to". */
  children?: ReactNode;
}

/**
 * One failure as one item of a `DiagnosticList` — kanzo-ui's `Problem` in keasy's words — for a list
 * that is not only this failure, such as kanzo-ui's `FindingsGroup`. `data-problem` and `data-code`
 * sit on the item, which is what an end-to-end test finds.
 */
export function ProblemItem({ error, uncoded, children }: ProblemItemProps) {
  return (
    <Problem copy={copy} data-problem="" error={coded(error, uncoded)}>
      {children}
    </Problem>
  );
}

export interface ProblemViewProps extends Omit<ProblemItemProps, "children"> {
  /** Offered beside the problem as a retry. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * The one way keasy shows a failure: what was thrown — fossil's `FossilError`, the server's
 * refusal, a library's coded error, the browser's own — as a list of one {@link ProblemItem}.
 */
export function ProblemView({ onRetry, retryLabel = "Try again", className, ...item }: ProblemViewProps) {
  return (
    <DiagnosticList className={className}>
      <ProblemItem {...item}>
        {onRetry && (
          <Button onClick={onRetry} size="sm" variant="outline">
            {retryLabel}
          </Button>
        )}
      </ProblemItem>
    </DiagnosticList>
  );
}
