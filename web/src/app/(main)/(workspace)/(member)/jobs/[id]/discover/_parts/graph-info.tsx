"use client";

import { ScrollArea } from "@kanzo-tech/ui";
import { GraphInspector, GraphSearch } from "@kanzo-tech/graph";

/** The Info panel: find something and go to it, then read it. */
export function GraphInfo() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <GraphSearch placeholder="Find anything in the graph…" />
      </div>
      <ScrollArea className="min-h-0 flex-1 p-3">
        <GraphInspector />
      </ScrollArea>
    </div>
  );
}
