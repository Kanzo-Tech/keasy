"use client";

import { useMemo } from "react";
import {
  type Finding,
  type FindingCounts,
  FindingsContent,
  FindingsGoTo,
  FindingsGroup,
  FindingsRoot,
  FindingsTrigger,
} from "@kanzo-tech/ui";
import type { CheckRow } from "@/lib/fossil/checker";
import { type Shown } from "@/lib/errors";
import { ProblemItem } from "@/components/problem-view";

/** LSP severity: 1 error, 2 warning, 3 information — as kanzo-ui's variants. */
const VARIANT = { 1: "destructive", 2: "warning", 3: "info" } as const;
const SEVERITY = { 1: "error", 2: "warning", 3: "info" } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Errors and warnings side by side; notes are named only when they are all there is. */
function tally({ destructive, warning, info }: FindingCounts): string {
  const parts = [destructive && plural(destructive, "error"), warning && plural(warning, "warning")].filter(Boolean);
  return parts.length ? parts.join(" · ") : info ? plural(info, "note") : "Valid";
}

interface CompilerFinding extends Finding {
  row: CheckRow;
}

/** A finding as the one failure view shows it: its code, its line and title, its message and help. */
function problemOf(row: CheckRow): Shown {
  return {
    code: row.code,
    title: `Line ${row.range.start.line + 1} · ${row.title}`,
    detail: row.message,
    help: row.help,
    severity: SEVERITY[row.severity],
    data: row.data,
  };
}

const item = ({ row }: CompilerFinding) => (
  <ProblemItem actions={<FindingsGoTo variant="outline">Go to line</FindingsGoTo>} problem={problemOf(row)} />
);

/**
 * The compiler's tally, and the findings behind it: pressing it lists every finding, errors first
 * and each by line, with the line to go to. The same rows the gutter shows.
 */
export function FindingsBadge({
  findings,
  open,
  onOpenChange,
  onSelect,
}: {
  findings: readonly CheckRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (finding: CheckRow) => void;
}) {
  const listed = useMemo(
    () =>
      [...findings]
        .sort((a, b) => a.range.start.line - b.range.start.line)
        .map((row, i): CompilerFinding => ({ id: String(i), variant: VARIANT[row.severity], row })),
    [findings],
  );

  return (
    <FindingsRoot
      findings={listed}
      onOpenChange={(d) => onOpenChange(d.open)}
      onSelect={(f) => onSelect(f.row)}
      open={open}
    >
      <FindingsTrigger size="lg">{tally}</FindingsTrigger>
      <FindingsContent description="What the compiler found in the program.">
        <FindingsGroup title="Errors" variant="destructive">
          {item}
        </FindingsGroup>
        <FindingsGroup title="Warnings" variant="warning">
          {item}
        </FindingsGroup>
        <FindingsGroup title="Notes" variant="info">
          {item}
        </FindingsGroup>
      </FindingsContent>
    </FindingsRoot>
  );
}
