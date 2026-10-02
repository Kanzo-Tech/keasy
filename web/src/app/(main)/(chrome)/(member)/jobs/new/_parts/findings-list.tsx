"use client";

import type { CheckRow } from "@/lib/fossil/checker";
import { type Shown } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";

/** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
const SEVERITY = { 1: "error", 2: "warning", 3: "info" } as const;

/** A finding as the one failure view shows it: its code, its line and title, its message and help. */
function finding(row: CheckRow): Shown {
  return {
    code: row.code,
    title: `Line ${row.range.start.line + 1} · ${row.title}`,
    detail: row.message,
    help: row.help,
    severity: SEVERITY[row.severity],
    data: row.data,
  };
}

/** The compiler's findings, the same rows the gutter shows. Each offers its line when `onSelect` is given. */
export function FindingsList({
  findings,
  onSelect,
}: {
  findings: readonly CheckRow[];
  onSelect?: (finding: CheckRow) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {findings.map((f, i) => (
        <li key={i}>
          <ProblemView
            onRetry={onSelect && (() => onSelect(f))}
            problem={finding(f)}
            retryLabel="Go to line"
          />
        </li>
      ))}
    </ul>
  );
}
