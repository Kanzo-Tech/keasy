"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@kanzo-tech/ui";
import { useGraphContext, useGraphState, type SelectionSource } from "@kanzo-tech/graph";
import { toastError } from "@/lib/errors";

/**
 * A finding you can point the canvas at — kanzo-ui's `workspace` showcase's, as it is there. The
 * Rules and Ask panels make the same offer, *these vertices, on the canvas*, so it is one
 * affordance, and its pressed state is derived from the live selection rather than stored.
 */
export interface FindingProps {
  children: ReactNode;
  /** The dense ids this finding covers. Nothing is queried until the reader asks. */
  load: () => Promise<number[]>;
  /** Shown in the corner and used as this finding's identity, so keep it distinct within a panel. */
  label: string;
  source: SelectionSource;
  disabled?: boolean;
}

export function Finding({ children, disabled, label, load, source }: FindingProps) {
  const { select } = useGraphContext();
  const selection = useGraphState((s) => s.selection);
  const [busy, setBusy] = useState(false);
  const active = selection?.source === source && selection.label === label;

  const toggle = async () => {
    if (active) {
      select(null);
      return;
    }
    setBusy(true);
    try {
      select(await load(), source, label);
    } catch (err) {
      toastError(err, "The vertices could not be selected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      aria-pressed={active}
      className={cn(
        "w-full rounded-md border p-2 text-start transition-colors",
        "disabled:cursor-default disabled:opacity-60",
        active ? "border-primary bg-accent" : "hover:bg-secondary disabled:hover:bg-transparent",
      )}
      disabled={disabled || busy}
      onClick={() => void toggle()}
      type="button"
    >
      {children}
    </button>
  );
}
