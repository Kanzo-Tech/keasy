"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Badge, cn, Show } from "@kanzo-tech/ui";
import type { Selection, SelectionClause } from "@kanzo-tech/ui/analytics";

/*
 * The frames kanzo-ui's `workspace` showcase builds its dashboard from — `docs/lib/chart-card`,
 * `dashboard-grid` and `filter-chips` there. The library ships the charts and not these, because
 * they are an arrangement with no behaviour of their own; so they are copied, as they are.
 */

/** The titled frame a chart sits in — header (title · description · action), plot, then legend. */
export function ChartCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", className)} data-slot="chart-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate font-medium text-foreground text-sm">{title}</h3>
          <Show when={!!description}>
            <p className="text-muted-foreground text-xs">{description}</p>
          </Show>
        </div>
        <Show when={!!action}>
          <div className="shrink-0">{action}</div>
        </Show>
      </div>
      {children}
    </div>
  );
}

/** A responsive grid for stat tiles and chart cards — auto-fits columns to the width. */
export function DashboardGrid({
  minColumnWidth = 240,
  children,
  className,
}: {
  minColumnWidth?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-4", className)}
      data-slot="dashboard-grid"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${minColumnWidth}px, 100%), 1fr))` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** A clause, as something a person can read. */
function clauseLabel(clause: SelectionClause): string {
  const field = clause.fields?.map((f) => String(f).replace(/^"|"$/g, "")).join(", ") ?? "filter";
  const value = clause.value;
  if (value == null) return field;
  if (Array.isArray(value)) {
    const [lo, hi] = value as [unknown, unknown];
    if (value.length === 2 && typeof lo === "number" && typeof hi === "number") {
      return `${field} ${lo.toFixed(1)} – ${hi.toFixed(1)}`;
    }
    if (value.length === 1) return `${field} ${String(Array.isArray(lo) ? lo[0] : lo)}`;
    return `${field} · ${value.length} selected`;
  }
  return `${field} ${String(value)}`;
}

/** The live clause list of a selection, re-read on every published value. */
export function useClauses(selection: Selection): readonly SelectionClause[] {
  const [clauses, setClauses] = useState<readonly SelectionClause[]>([]);
  useEffect(() => {
    const sync = () => setClauses([...selection.clauses]);
    sync();
    selection.addEventListener("value", sync);
    return () => selection.removeEventListener("value", sync);
  }, [selection]);
  return clauses;
}

/** Retract one clause: its source's own `reset` where it has one, an empty clause otherwise. */
function dropClause(selection: Selection, clause: SelectionClause): void {
  const source = clause.source as { reset?: () => void };
  if (typeof source.reset === "function") source.reset();
  else selection.update({ ...clause, value: undefined, predicate: null });
}

/** What a crossfilter currently holds, as removable chips. */
export function FilterChips({ selection, className }: { selection: Selection; className?: string }) {
  const clauses = useClauses(selection);
  if (clauses.length === 0) return null;
  return (
    <div className={className}>
      {clauses.map((clause, i) => (
        <Badge className="gap-1 ps-2 pe-1" key={i} size="sm" variant="secondary">
          {clauseLabel(clause)}
          <button
            aria-label={`Remove ${clauseLabel(clause)}`}
            className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
            onClick={() => dropClause(selection, clause)}
            type="button"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
