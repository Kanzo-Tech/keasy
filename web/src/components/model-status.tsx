"use client";

import { ModelBadge } from "@kanzo-tech/ai";
import { describeProblem } from "@/components/problem-view";
import { useLoadModel, useModelLoad } from "@/lib/ai";
import { coded } from "@/lib/errors";

/**
 * How the page's model stands, where a screen asks it: `@kanzo-tech/ai`'s `ModelBadge` over keasy's
 * load — preparing, with its progress (the first time on this device the download, after that the
 * load from the browser's cache), ready, or failed, with why behind it in keasy's words and an uncoded
 * failure as `llm/failed`. A question asked meanwhile waits for it. The load itself is started by the
 * screen a person opened (`usePreloadModel`), not by this; the badge's retry starts it again.
 */
export function ModelStatus({ className }: { className?: string }) {
  const load = useModelLoad();
  const retry = useLoadModel();
  return (
    <ModelBadge
      className={className}
      describe={describeProblem}
      load={load.state === "failed" ? { state: "failed", error: coded(load.error, "llm/failed") } : load}
      onRetry={retry}
    />
  );
}
