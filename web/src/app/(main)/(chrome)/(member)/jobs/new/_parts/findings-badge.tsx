"use client";

import { useMemo } from "react";
import { Badge, Popover, PopoverContent, PopoverTrigger, Show } from "@kanzo-tech/ui";
import type { CheckRow } from "@/lib/fossil/checker";
import { type Shown } from "@/lib/errors";
import { ProblemView } from "@/components/problem-view";

/** LSP severity: 1 error, 2 warning, 3 information. */
const SEVERITIES = [1, 2, 3] as const;
const SEVERITY = { 1: "error", 2: "warning", 3: "info" } as const;
const WORD = { 1: "error", 2: "warning", 3: "note" } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Errors and warnings side by side; notes alone leave the program valid. */
function tallyOf(errors: number, warnings: number): string {
  const parts = [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Valid";
}

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
  const groups = useMemo(
    () =>
      SEVERITIES.map((severity) => ({
        severity,
        rows: findings
          .filter((f) => f.severity === severity)
          .sort((a, b) => a.range.start.line - b.range.start.line),
      })).filter((g) => g.rows.length > 0),
    [findings],
  );
  const errors = findings.filter((f) => f.severity === 1).length;
  const warnings = findings.filter((f) => f.severity === 2).length;
  const tally = tallyOf(errors, warnings);

  return (
    <Popover
      lazyMount
      onOpenChange={(d) => onOpenChange(d.open)}
      open={open}
      positioning={{ placement: "bottom-end" }}
      unmountOnExit
    >
      <PopoverTrigger asChild>
        <Badge asChild size="lg" variant={errors ? "destructive" : warnings ? "warning" : "success"}>
          <button type="button">{tally}</button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-3 py-2">
          <p className="font-medium text-sm">
            {groups.length
              ? groups.map((g) => plural(g.rows.length, WORD[g.severity])).join(" · ")
              : "No findings"}
          </p>
          <p className="text-muted-foreground text-xs">What the compiler found in the program.</p>
        </div>
        <Show
          fallback={
            <p className="p-3 text-muted-foreground text-sm">
              Every reference resolves and every mapping type-checks.
            </p>
          }
          when={groups.length > 0}
        >
          <div className="max-h-[min(28rem,60vh)] overflow-y-auto">
            <div className="flex flex-col gap-3 p-3">
              {groups.map((g) => (
                <section className="flex flex-col gap-1.5" key={g.severity}>
                  <h3 className="font-medium text-muted-foreground text-xs capitalize">
                    {WORD[g.severity]}s · {g.rows.length}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {g.rows.map((f, i) => (
                      <li key={i}>
                        <ProblemView
                          onRetry={() => onSelect(f)}
                          problem={finding(f)}
                          retryLabel="Go to line"
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </Show>
      </PopoverContent>
    </Popover>
  );
}
