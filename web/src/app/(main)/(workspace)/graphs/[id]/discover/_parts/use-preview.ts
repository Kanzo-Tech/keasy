import { startTransition, useEffect, useState } from "react";
import { previewOf, useGraphBuild, type Preview } from "@/lib/fossil/build";

/**
 * The preview Discover opens graph `id` on: while this tab builds it and the preview is what there
 * is (`lib/fossil/build.ts`), its corpus; once the whole graph lands, nothing — and the page switches
 * to the graph's own. The switch is a transition, so the preview stays on screen while the whole
 * graph attaches, and what the person was reading is not replaced by a spinner.
 */
export function usePreview(id: string): Preview | undefined {
  const now = previewOf(useGraphBuild(id));
  const [shown, setShown] = useState(now);
  useEffect(() => {
    startTransition(() => setShown(now));
  }, [now]);
  return shown;
}
