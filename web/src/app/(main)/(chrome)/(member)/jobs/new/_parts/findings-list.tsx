"use client";

import { cn } from "@kanzo-tech/ui";
import type { CheckRow } from "@/lib/fossil/checker";

/** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
const SEVERITY = [
  { label: "error", text: "text-destructive" },
  { label: "error", text: "text-destructive" },
  { label: "warning", text: "text-warning" },
  { label: "info", text: "text-info" },
  { label: "hint", text: "text-muted-foreground" },
] as const;

/** The compiler's findings, the same rows the gutter shows. A row is a button when `onSelect` is given. */
export function FindingsList({
  findings,
  onSelect,
}: {
  findings: readonly CheckRow[];
  onSelect?: (finding: CheckRow) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {findings.map((f, i) => {
        const severity = SEVERITY[f.severity] ?? SEVERITY[4];
        const body = (
          <>
            <span className={cn("font-medium text-xs", severity.text)}>
              Line {f.range.start.line + 1} · {severity.label}
            </span>
            <span className="text-muted-foreground text-sm">{f.message}</span>
          </>
        );
        return (
          <li key={i}>
            {onSelect ? (
              <button
                className="flex w-full flex-col gap-0.5 rounded-lg border p-2.5 text-start transition-colors hover:bg-muted"
                onClick={() => onSelect(f)}
                type="button"
              >
                {body}
              </button>
            ) : (
              <div className="flex flex-col gap-0.5 rounded-lg border p-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
