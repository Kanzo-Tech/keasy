"use client";

import type { ComponentProps, ReactNode } from "react";
import { CircleCheck, CircleDashed, type LucideIcon } from "lucide-react";
import { cn, Spinner } from "@kanzo-tech/ui";

/**
 * The steps a thread takes, in the API of AI Elements' `ChainOfThought` (elements.ai-sdk.dev,
 * *chain-of-thought*): a list, and a step with `icon`, `label`, `description` and a `status` of
 * `complete`, `active` or `pending`. Local and thin on purpose — it is a candidate for
 * `@kanzo-tech/ai` (kanzo-ui 0.47), and when it lands this file is an import swap.
 *
 * Two departures, both from what AI Elements draws: the icon of an `active` step is `Working`'s
 * spinner rather than a glyph (one vocabulary for busy), and the list is not collapsible — the
 * future steps are the point, so they are always visible. `children` is an action on the step
 * (*Open in the editor*), which AI Elements has no slot for.
 */
export function ChainOfThought({ className, ...props }: ComponentProps<"ol">) {
  return <ol className={cn("flex list-none flex-col gap-1.5 p-0 text-muted-foreground text-sm", className)} {...props} />;
}

export type ChainOfThoughtStatus = "complete" | "active" | "pending";

export interface ChainOfThoughtStepProps extends Omit<ComponentProps<"li">, "children"> {
  /** Replaces the status's own icon; a `LucideIcon`, as AI Elements takes. */
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: ChainOfThoughtStatus;
  /** An action on the step, after its label. */
  children?: ReactNode;
}

export function ChainOfThoughtStep({ icon: Icon, label, description, status = "complete", children, className, ...props }: ChainOfThoughtStepProps) {
  const glyph =
    Icon !== undefined ? (
      <Icon aria-hidden className="size-4" />
    ) : status === "active" ? (
      <Spinner aria-hidden className="size-4 text-success-foreground" />
    ) : status === "complete" ? (
      <CircleCheck aria-hidden className="size-4 text-success-foreground" />
    ) : (
      <CircleDashed aria-hidden className="size-4" />
    );
  return (
    <li
      className={cn("flex items-center gap-2.5", status === "active" && "font-medium text-foreground", status === "pending" && "text-muted-foreground/70", className)}
      data-status={status}
      {...props}
    >
      <span className="flex shrink-0">{glyph}</span>
      <span>
        {label}
        {description && <span className="font-normal text-muted-foreground/80"> · {description}</span>}
      </span>
      {children}
    </li>
  );
}
