"use client";

import { CircleCheck, Cloud } from "lucide-react";
import { ModelBadge } from "@kanzo-tech/ai";
import { Badge, Tooltip, TooltipContent, TooltipTrigger } from "@kanzo-tech/ui";
import { describeProblem } from "@/components/problem-view";
import { useExternalModel, useLoadModel, useModelLoad } from "@/lib/ai";
import { coded } from "@/lib/errors";

/**
 * How the page's model stands, where a screen asks it: `@kanzo-tech/ai`'s `ModelBadge` over keasy's
 * load — preparing, with its progress (the first time on this device the download, after that the
 * load from the browser's cache), or failed, with why behind it in keasy's words and an uncoded
 * failure as `llm/failed`. Ready, there is nothing to open: the badge says so, and where the model
 * runs is a tooltip. A question asked meanwhile waits for it. The load itself is started by the
 * screen a person opened (`usePreloadModel`), not by this; the badge's retry starts it again.
 *
 * With an external model there is nothing to load: the badge names the model, and that questions go
 * to the workspace's provider.
 */
export function ModelStatus({ className }: { className?: string }) {
  const external = useExternalModel();
  const load = useModelLoad();
  const retry = useLoadModel();
  if (external) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={className} data-load="external" pill tabIndex={0} variant="success">
            <Cloud aria-hidden />
            {external.model}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Runs on the workspace&apos;s AI provider</TooltipContent>
      </Tooltip>
    );
  }
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
