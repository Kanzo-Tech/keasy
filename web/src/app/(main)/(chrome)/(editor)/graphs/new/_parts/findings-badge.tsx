"use client";

import { useMemo } from "react";
import {
  type DescribePlace,
  type Finding,
  FindingsBadge as Badge,
  FindingsContent,
  FindingsGroup,
  FindingsHeader,
  FindingsItem,
  FindingsList,
  FindingsRoot,
  FindingsSource,
  type FindingSeverity,
  type FindingTally,
  PopoverDescription,
  tallyFindings,
} from "@kanzo-tech/ui";
import type { Diagnostic } from "@fossil-lang/types";
import { copyOf, pageOf } from "@/lib/errors";
import { counted } from "@/lib/ui/format";

/** LSP severity: 1 error, 2 warning, 3 information, 4 hint — as kanzo-ui's severities, a hint a note. */
const SEVERITY = { 1: "violation", 2: "warning", 3: "info", 4: "info" } as const satisfies Record<number, FindingSeverity>;

/** The compiler's words for a severity: an error, not a violation. */
const LABELS = { severity: { violation: "Error", warning: "Warning", info: "Note" } };

const GROUPS = [
  { severity: "violation", title: "Errors" },
  { severity: "warning", title: "Warnings" },
  { severity: "info", title: "Notes" },
] as const;


/** Errors and warnings side by side; notes are named only when they are all there is. */
function tally(t: FindingTally | undefined): string {
  if (!t) return "Valid";
  const parts = [t.violation && counted(t.violation, "error"), t.warning && counted(t.warning, "warning")].filter(Boolean);
  return parts.length ? parts.join(" · ") : t.info ? counted(t.info, "note") : "Valid";
}

/** What the popover says it covered: *2 errors · 1 warning*, and the notes when there are any. */
function scope(t: FindingTally): string {
  return [counted(t.violation, "error"), counted(t.warning, "warning"), t.info ? counted(t.info, "note") : ""].filter(Boolean).join(" · ");
}

/** A diagnostic as one result: keasy's title for its code when it has one, the compiler's otherwise. */
function findingOf(row: Diagnostic): Finding<Diagnostic> {
  const copy = copyOf(row.code, row.data);
  return {
    severity: SEVERITY[row.severity],
    message: copy?.detail ?? row.message,
    rule: { id: row.code, label: copy?.title ?? row.title },
    place: row,
    help: row.help,
  };
}

/**
 * The compiler's tally, and the findings behind it: pressing it lists every finding, errors first
 * and each by line, each with *Go to line*. The same rows the gutter shows. The header says what was
 * checked — the program, `graph.fossil` — and how much was found.
 */
export function FindingsBadge({
  findings,
  open,
  onOpenChange,
  onSelect,
}: {
  findings: readonly Diagnostic[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (finding: Diagnostic) => void;
}) {
  const listed = useMemo(
    () => [...findings].sort((a, b) => a.range.start.line - b.range.start.line).map(findingOf),
    [findings],
  );
  const describe: DescribePlace<Diagnostic> = (row) => {
    // The page that explains the code, as `ProblemItem` linked it: a `detail`, not the finding's
    // `help`, which is text and is the compiler's.
    const page = pageOf(row.code);
    return {
      where: `Line ${row.range.start.line + 1}`,
      detail: page && (
        <a className="underline underline-offset-2" href={page} rel="noreferrer" target="_blank">
          What {row.code} means
        </a>
      ),
    };
  };

  const counted = tallyFindings(listed);
  return (
    <FindingsRoot labels={LABELS} onOpenChange={(d) => onOpenChange(d.open)} open={open} tally={counted}>
      <Badge size="lg">{tally}</Badge>
      <FindingsContent>
        <FindingsHeader>
          <FindingsSource>graph.fossil</FindingsSource>
          <PopoverDescription className="text-xs">{scope(counted)}</PopoverDescription>
        </FindingsHeader>
        <FindingsList empty={<p className="text-muted-foreground text-sm">The compiler found nothing in the program.</p>}>
          {GROUPS.map(({ severity, title }) => {
            const rows = listed.filter((f) => f.severity === severity);
            if (rows.length === 0) return null;
            return (
              <FindingsGroup key={severity} tally={tallyFindings(rows)} title={title}>
                {rows.map((finding, i) => (
                  <FindingsItem
                    action={{ label: "Go to line", run: () => onSelect(finding.place) }}
                    describe={describe}
                    finding={finding}
                    key={i}
                  />
                ))}
              </FindingsGroup>
            );
          })}
        </FindingsList>
      </FindingsContent>
    </FindingsRoot>
  );
}
