"use client";

import { useMemo } from "react";
import { ScrollArea, Skeleton } from "@kanzo-tech/ui";
import {
  Dashboard,
  type Relation,
  RelationPicker,
  relationIdentities,
  relationKey,
  relationRootKey,
  semiJoinOf,
  type TableExpr,
} from "@kanzo-tech/ui/analytics";
import { SavedBy } from "@/components/provenance";
import { Boundary, Failed } from "@/components/boundary";
import { useJoinGraph } from "@/lib/fossil/corpus";
import { useDashboardStore } from "./dashboard-store";

/**
 * The Dashboard view: kanzo-ui's `Dashboard` over a relation of the graph — a type, or a type and the
 * hops a `RelationPicker` takes from it — on the crossfilter the graph reads. A lasso on the canvas
 * filters it, and its tiles publish to the page as one semi-join on the root's key, so a brush here
 * greys out the canvas. The graph keeps one saved document, a spec per relation; a relation nobody
 * has edited draws the automatic one; the document is the page's (`./dashboard-store`), because the
 * Ask panel adds its answers to it too. The relation is the page's, and its `FilterBar` draws this
 * dashboard's filters.
 */
export interface DashboardViewProps {
  relation: Relation;
  onRelationChange: (relation: Relation) => void;
  /** `relation` as the query its rows come from. */
  table: TableExpr;
}

export default function DashboardView(props: DashboardViewProps) {
  return (
    <Boundary className="p-4" fallback={<Skeleton className="h-full w-full" />}>
      <SavedDashboard {...props} />
    </Boundary>
  );
}

function SavedDashboard({ relation, onRelationChange, table }: DashboardViewProps) {
  const graph = useJoinGraph();
  const store = useDashboardStore();

  const key = relationKey(graph, relation);
  const identities = useMemo(() => relationIdentities(graph, relation), [graph, relation]);
  const publish = useMemo(() => semiJoinOf(relationRootKey(graph, relation), table, { label: key }), [graph, relation, table, key]);

  // The document is read once; a failed read is shown in place of the dashboard, not replaced by
  // the automatic one an edit would then overwrite.
  if (store.status === "pending") return <Skeleton className="h-full w-full" />;
  if (store.status === "error") return <Failed className="p-4" error={store.error} retry={store.retry} />;
  const { saved, current, edit } = store;

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
            edit
              ? (spec) => {
                  // `undefined` is "Reset to automatic": the relation's entry goes, and the automatic
                  // dashboard follows its statistics again.
                  const byRelation = { ...current.byRelation };
                  if (spec === undefined) delete byRelation[key];
                  else byRelation[key] = spec;
                  edit.change({ ...current, byRelation });
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
