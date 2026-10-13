"use client";

import { cn, Progress } from "@kanzo-tech/ui";
import { ProblemView } from "@/components/problem-view";
import { useLoadModel, useModelLoad } from "@/lib/ai";
import { coded } from "@/lib/errors";

/**
 * How the page's model stands, where a screen asks it: preparing, with its progress — the first time
 * on this device the download, after that the load from the browser's cache — or why it cannot, and
 * nothing once it is ready. A question asked meanwhile waits for it. The load itself is started by the
 * screen a person opened (`usePreloadModel`), not by this.
 */
export function ModelStatus({ className }: { className?: string }) {
  const load = useModelLoad();
  const retry = useLoadModel();
  if (load.state === "loading") {
    return (
      <div className={cn("flex w-full flex-col gap-1 text-muted-foreground text-xs", className)}>
        <span>Preparing the model on this device…</span>
        <Progress aria-label="Preparing the model" value={Math.round(load.progress * 100)} />
      </div>
    );
  }
  if (load.state === "failed") {
    // A browser or a deployment that cannot run it says so once; a download that failed can be retried.
    const error = coded(load.error, "llm/failed");
    return (
      <ProblemView className={className} error={error} onRetry={error.code === "ai/unavailable" ? undefined : retry} />
    );
  }
  return null;
}
