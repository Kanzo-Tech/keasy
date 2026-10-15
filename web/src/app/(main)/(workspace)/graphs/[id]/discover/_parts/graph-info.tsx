"use client";

import { ScrollArea } from "@kanzo-tech/ui";
import { GraphInspector, GraphSearch } from "@kanzo-tech/graph";
import { Boundary } from "@/components/boundary";
import { GraphAssumptions } from "./graph-assumptions";

/** The Info panel: find something and go to it, then read it — and what the assistant decided. */
export function GraphInfo() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <GraphSearch translations={{ placeholder: "Find anything in the graph…" }} />
      </div>
      <ScrollArea className="min-h-0 flex-1 p-3">
        {/* Its own boundary: the inspector does not wait on the graph's record, nor fail with it. */}
        <Boundary fallback={null}>
          <GraphAssumptions />
        </Boundary>
        <GraphInspector />
      </ScrollArea>
    </div>
  );
}
