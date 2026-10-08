"use client";

import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollArea, Skeleton, useDebouncedCommit } from "@kanzo-tech/ui";
import {
  Dashboard,
  type Dashboards,
  parseDashboards,
  type Relation,
  RelationPicker,
  relationIdentities,
  relationKey,
  semiJoinOf,
  type TableExpr,
} from "@kanzo-tech/ui/analytics";
import { SavedBy } from "@/components/provenance";
import { $api, http } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { Boundary } from "@/components/boundary";
import { useCorpus, useJoinGraph } from "@/lib/fossil/corpus";

/**
 * The Dashboard view: kanzo-ui's `Dashboard` over a relation of the graph — a type, or a type and the
 * hops a `RelationPicker` takes from it — on the crossfilter the graph reads. A lasso on the canvas
 * filters it, and its tiles publish to the page as one semi-join on the root's key, so a brush here
 * greys out the canvas. The graph keeps one saved document, a spec per relation; a relation nobody
 * has edited draws the automatic one. The relation is the page's: its `FilterBar` counts the same
 * rows, and draws this dashboard's filters.
 */
export interface DashboardViewProps {
  relation: Relation;
  onRelationChange: (relation: Relation) => void;
  /** `relation` as the query its rows come from. */
  table: TableExpr;
}

export default function DashboardView(props: DashboardViewProps) {
  // The saved document is read once; a failed read is shown in place of the dashboard, not
  // replaced by the automatic one an edit would then overwrite.
  return (
    <Boundary className="p-4" fallback={<Skeleton className="h-full w-full" />}>
      <SavedDashboard {...props} />
    </Boundary>
  );
}

/** Saved after a pause, not per edit: dragging a slider is many edits and one decision. */
const SAVE_MS = 800;

function SavedDashboard({ relation, onRelationChange, table }: DashboardViewProps) {
  const { graphId } = useCorpus();
  const graph = useJoinGraph();

  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/dashboard", init);
  const saved = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}/dashboard", init));
  // Everyone reads the dashboard; only whoever may change the graph edits and saves it.
  const { can_modify } = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", init));

  // What the server holds, checked whole: a document an earlier release wrote is refused, not
  // migrated, and the Boundary above shows why.
  const stored = useMemo(() => parseDashboards(saved?.spec), [saved]);
  const save = useMutation({
    mutationFn: async (spec: Dashboards) => (await http.PUT("/v1/graphs/{id}/dashboard", { ...init, body: { spec: { ...spec } } })).data,
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
    onError: (err) => toastError(err, "Failed to save the dashboard"),
  });
  const { draft, change } = useDebouncedCommit(stored, (spec) => save.mutate(spec), SAVE_MS);
  // What is on screen: the edit being typed, else — while it is being written — what was written,
  // else what the server holds.
  const current = draft !== stored ? draft : save.isPending ? save.variables : draft;

  const key = relationKey(graph, relation);
  const identities = useMemo(() => relationIdentities(graph, relation), [graph, relation]);
  const publish = useMemo(() => semiJoinOf(identities[0].column, table, { label: key }), [identities, table, key]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-3 py-1">
        <RelationPicker className="min-w-0" graph={graph} onValueChange={onRelationChange} value={relation} />
        {saved && <SavedBy className="ms-auto shrink-0" of={saved} />}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Dashboard
          className="p-4"
          exclude={identities.map((i) => i.column)}
          key={key}
          onChange={
            can_modify
              ? (spec) => {
                  // `undefined` is "Reset to automatic": the relation's entry goes, and the automatic
                  // dashboard follows its statistics again.
                  const byRelation = { ...current.byRelation };
                  if (spec === undefined) delete byRelation[key];
                  else byRelation[key] = spec;
                  change({ byRelation });
                }
              : undefined
          }
          publish={publish}
          table={table}
          value={current.byRelation[key]}
        />
      </ScrollArea>
    </div>
  );
}
