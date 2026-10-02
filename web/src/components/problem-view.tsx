"use client";

import type { Foreign, Related, Severity } from "@fossil-lang/types";
import {
  Button,
  Diagnostic,
  DiagnosticActions,
  DiagnosticContent,
  DiagnosticDescription,
  DiagnosticHeader,
  DiagnosticList,
  DiagnosticSeverity,
  DiagnosticSource,
  DiagnosticTitle,
  DiagnosticTrigger,
  Show,
} from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";
import { copyOf, pageOf, type Shown } from "@/lib/errors";

const VARIANT = { error: "destructive", warning: "warning", info: "info" } as const;
const WORD: Record<Severity, string> = { error: "Error", warning: "Warning", info: "Note" };

/** One row of the tree: a problem, a compile diagnostic it relates, or a cause fossil did not raise. */
interface Row {
  code?: string;
  title: string;
  detail?: string;
  help?: string;
  severity: Severity;
  children: Row[];
}

/**
 * A cause a library kept as `{ name, detail }`. keasy's `ApiError` is named by its code so that the
 * code survives that (fossil's wire): a name in the grammar is shown as the code it is.
 */
function foreign(cause: Foreign): Row {
  if (CODED.test(cause.name)) {
    return {
      code: cause.name,
      title: copyOf(cause.name)?.title ?? cause.name,
      detail: cause.detail,
      severity: "error",
      children: [],
    };
  }
  return { title: cause.name, detail: cause.detail, severity: "error", children: [] };
}

const CODED = /^[a-z][a-z-]*\/[a-z][a-z-]*$/;
const related = (r: Related): Row => ({ title: r.detail, help: r.help, severity: r.severity, children: [] });

function rows(problem: Shown): Row[] {
  const cause = problem.cause === undefined ? [] : ["code" in problem.cause ? raw(problem.cause) : foreign(problem.cause)];
  return [...cause, ...(problem.related ?? []).map(related)];
}

/** A problem in its own words, with no copy of keasy's over it. */
function raw(problem: Shown): Row {
  return { ...problem, severity: problem.severity ?? "error", children: rows(problem) };
}

/**
 * A problem in keasy's words where the registry has them. A code with no entry is shown as its
 * author wrote it; one whose detail keasy rewrites keeps the original one level down, closed.
 */
function worded(problem: Shown): Row & { link?: { label: string; href: string } } {
  const copy = copyOf(problem.code);
  const own = raw(problem);
  if (!copy) return own;
  return {
    ...own,
    title: copy.title ?? problem.title,
    detail: copy.detail ?? problem.detail,
    link: copy.link,
    children: copy.detail === undefined ? own.children : [{ ...own, detail: problem.detail }],
  };
}

function Item({ row, open, actions }: { row: Row; open?: boolean; actions?: React.ReactNode }) {
  const page = row.code ? pageOf(row.code) : undefined;
  const more = Boolean(row.detail || row.help || row.children.length > 0);
  return (
    <Diagnostic data-code={row.code} defaultOpen={open} variant={VARIANT[row.severity]}>
      <DiagnosticHeader>
        <DiagnosticSeverity>{WORD[row.severity]}</DiagnosticSeverity>
        <DiagnosticTitle>{row.title}</DiagnosticTitle>
        <Show when={row.code !== undefined}>
          <DiagnosticSource asChild>
            {page ? (
              <a href={page} rel="noreferrer" target="_blank">
                {row.code}
              </a>
            ) : (
              <span>{row.code}</span>
            )}
          </DiagnosticSource>
        </Show>
        <DiagnosticActions>
          {actions}
          <Show when={more}>
            <DiagnosticTrigger aria-label="Details" />
          </Show>
        </DiagnosticActions>
      </DiagnosticHeader>
      <DiagnosticContent>
        <Show when={Boolean(row.detail)}>
          <DiagnosticDescription className="whitespace-pre-wrap">{row.detail}</DiagnosticDescription>
        </Show>
        <Show when={Boolean(row.help)}>
          <DiagnosticDescription>{row.help}</DiagnosticDescription>
        </Show>
        <Show when={row.children.length > 0}>
          <DiagnosticList>
            {/* A coded cause is part of the explanation, so it is open; a foreign one stays folded. */}
            {row.children.map((child, i) => (
              <Item key={i} open={child.code !== undefined} row={child} />
            ))}
          </DiagnosticList>
        </Show>
      </DiagnosticContent>
    </Diagnostic>
  );
}

export interface ProblemViewProps {
  problem: Shown;
  /** Offered beside the problem as a retry. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * The one way keasy shows a failure: a {@link Shown} — fossil's problem, the server's refusal, or
 * the browser's own — as kanzo-ui's `Diagnostic`, open at rest, with its causes and related
 * diagnostics nested below it and its code linked to the page that explains it. `data-code` carries
 * the code on the view and on every coded row of its tree, the one thing an end-to-end test asserts on.
 */
export function ProblemView({ problem, onRetry, retryLabel = "Try again", className }: ProblemViewProps) {
  const row = worded(problem);
  return (
    <DiagnosticList className={className} data-code={problem.code} data-problem="">
      <Item
        actions={
          <>
            {row.link && (
              <Button asChild size="sm" variant="outline">
                <Link href={row.link.href}>{row.link.label}</Link>
              </Button>
            )}
            {onRetry && (
              <Button onClick={onRetry} size="sm" variant="outline">
                {retryLabel}
              </Button>
            )}
          </>
        }
        open
        row={row}
      />
    </DiagnosticList>
  );
}
