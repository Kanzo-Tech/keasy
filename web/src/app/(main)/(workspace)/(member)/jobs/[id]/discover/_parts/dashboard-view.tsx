"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea, Skeleton, ToggleGroup, ToggleGroupItem } from "@kanzo-tech/ui";
import { Dashboard, type DashboardSpec, useQueryRows } from "@kanzo-tech/ui/analytics";
import { TableRefNode } from "@uwdata/mosaic-sql";
import { $api, http } from "@/lib/api/client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { Boundary } from "@/components/boundary";
import { roleColumns, useCorpus, vertexTables } from "@/lib/fossil/corpus";

/**
 * The Dashboard view: kanzo-ui's `Dashboard` over one vertex type at a time, on the crossfilter the
 * graph reads, so a lasso on the canvas filters it and a pick here dims the canvas. One type at a
 * time because a crossfilter predicate names columns, and another type's table lacks them.
 *
 * The job keeps one saved document, a spec per type; a type nobody has edited draws the automatic one.
 */

/** What `PUT /v1/jobs/{id}/dashboard` stores for this view. */
type SavedDashboards = {
  version: 1;
  byType: Record<string, DashboardSpec>;
};

const SAVE_MS = 800;

export default function DashboardView() {
  // The saved document is read once; a failed read is shown in place of the dashboard, not
  // replaced by the automatic one an edit would then overwrite.
  return (
    <Boundary className="p-4" fallback={<Skeleton className="h-full w-full" />}>
      <SavedDashboard />
    </Boundary>
  );
}

function SavedDashboard() {
  const { jobId } = useCorpus();
  const types = useQueryRows<{ table_name: string }>(vertexTables(jobId)).map((t) => t.table_name);
  const kept = useQueryRows<{ table_name: string; column_name: string }>(roleColumns(jobId));
  const [type, setType] = useState(types[0] ?? "");

  const saved = settled($api.useSuspenseQuery("get", "/v1/jobs/{id}/dashboard", { params: { path: { id: jobId } } }));
  // What the server holds, with this session's edits over it.
  const [edited, setEdited] = useState<Record<string, DashboardSpec>>({});
  const byType = useMemo(() => {
    const stored = (saved?.spec as SavedDashboards | undefined)?.byType ?? {};
    return { ...stored, ...edited };
  }, [saved, edited]);

  // Saved after a pause, not per edit: dragging a slider is many edits and one decision.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (spec: DashboardSpec) => {
    const next = { ...byType, [type]: spec };
    setEdited((prev) => ({ ...prev, [type]: spec }));
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      const body: SavedDashboards = { version: 1, byType: next };
      void http
        .PUT("/v1/jobs/{id}/dashboard", { params: { path: { id: jobId } }, body: { spec: body } })
        .catch((err: unknown) => toastError(err, "Failed to save the dashboard"));
    }, SAVE_MS);
  };
  useEffect(() => () => void (pending.current && clearTimeout(pending.current)), []);

  // fossil's bookkeeping is not a field to chart.
  const exclude = useMemo(() => kept.filter((c) => c.table_name === type).map((c) => c.column_name), [kept, type]);

  if (!types.includes(type)) return <Skeleton className="h-full w-full" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-muted-foreground text-xs">Type</span>
        <ToggleGroup
          aria-label="Vertex type"
          className="min-w-0 overflow-x-auto"
          multiple={false}
          onValueChange={(d) => d.value[0] && setType(d.value[0])}
          size="sm"
          spacing={2}
          value={[type]}
        >
          {types.map((t) => (
            <ToggleGroupItem key={t} value={t}>
              {t}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Dashboard
          className="p-4"
          exclude={exclude}
          key={type}
          onChange={change}
          rowNoun={type}
          table={new TableRefNode([jobId, type])}
          value={byType[type]}
        />
      </ScrollArea>
    </div>
  );
}
