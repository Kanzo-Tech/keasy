"use client";

import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn, Collapsible, CollapsibleContent, CollapsibleTrigger } from "@kanzo-tech/ui";

/**
 * What a thread was made from, in the API of AI Elements' `Sources` (elements.ai-sdk.dev,
 * *sources*): `Sources` holds a `SourcesTrigger` with a `count` and a `SourcesContent` of `Source`s.
 * Local and thin on purpose — a candidate for `@kanzo-tech/ai` (kanzo-ui 0.47), then an import swap.
 *
 * Here a `Source` is a file the person picked, not a link, so it takes no `href`; `SourcesContent`
 * also holds the sentence the person said it was about, which AI Elements has no place for.
 */
export function Sources({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn("not-prose text-sm", className)} {...props} />;
}

export function SourcesTrigger({ count, children, className, ...props }: { count: number } & ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger className={cn("flex items-center gap-2 text-muted-foreground hover:text-foreground", className)} {...props}>
      {children ?? <span className="font-medium">{count === 1 ? "Used 1 file" : `Used ${count} files`}</span>}
      <ChevronDown aria-hidden className="size-4" />
    </CollapsibleTrigger>
  );
}

export function SourcesContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn("flex flex-col gap-1 pt-2", className)} {...props} />;
}

export function Source({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("truncate text-muted-foreground", className)} {...props} />;
}
