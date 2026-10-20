"use client";

import { CircleCheck } from "lucide-react";
import { ModelBadge } from "@kanzo-tech/ai";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@kanzo-tech/ui";
import { describeProblem } from "@/components/problem-view";
import { useLoadModel, useModelLoad } from "@/lib/ai";
import { coded } from "@/lib/errors";

/**
 * How the page's model stands, where a screen asks it: `@kanzo-tech/ai`'s `ModelBadge` over keasy's
 * load — preparing, with its progress (the first time on this device the download, after that the
 * load from the browser's cache), or failed, with why behind it in keasy's words and an uncoded
 * failure as `llm/failed`. Ready, there is nothing to open: the badge says so, and where the model
 * runs is a tooltip. A question asked meanwhile waits for it. The load itself is started by the
 * screen a person opened (`usePreloadModel`), not by this; the badge's retry starts it again.
 */
export function ModelStatus({ className }: { className?: string }) {
  const load = useModelLoad();
  const retry = useLoadModel();
  if (load.state === "ready") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={className} data-load="ready" pill tabIndex={0} variant="success">
            <CircleCheck aria-hidden />
            Model ready
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Runs on this device</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <ModelBadge
      className={className}
      describe={describeProblem}
      load={load.state === "failed" ? { state: "failed", error: coded(load.error, "llm/failed") } : load}
      onRetry={retry}
    />
  );
}
