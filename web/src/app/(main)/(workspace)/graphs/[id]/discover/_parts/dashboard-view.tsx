"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AnswerAdded } from "@kanzo-tech/ai/data";
import { ScrollArea, Skeleton } from "@kanzo-tech/ui";
import { JoinResolver, type Relation, relationKey } from "@kanzo-tech/mosaic";
import { Dashboard, RelationPicker } from "@kanzo-tech/ui/analytics";
import { SavedBy } from "@/components/provenance";
import { Boundary, Failed } from "@/components/boundary";
import { useJoinGraph } from "@/lib/fossil/graph";
import { useDashboardStore } from "./dashboard-store";

/**
 * The Dashboard view: kanzo-ui's `Dashboard` over a relation of the graph — a type, or a type and the
 * hops a `RelationPicker` takes from it — on the page's one selection, the graph's too. A lasso on
 * the canvas filters it, and a brush on its tiles is published on its relation and crossed by key
 * along the joins, so it greys out the canvas. The graph keeps one saved document, a spec per relation; a relation nobody
 * has edited draws the automatic one; the document is the page's (`./dashboard-store`), because the
 * Ask panel adds its answers to it too. The relation is the page's, and its `FilterBar` draws this
 * dashboard's filters.
 */
export interface DashboardViewProps {
  relation: Relation;
  onRelationChange: (relation: Relation) => void;
  /** The tile *Open on the dashboard* asked for: scrolled into view, and ringed for a moment. */
  shown?: AnswerAdded;
}

export default function DashboardView(props: DashboardViewProps) {
  return (
    <Boundary className="p-4" fallback={<Skeleton className="h-full w-full" />}>
      <SavedDashboard {...props} />
    </Boundary>
  );
}

/** How long *Open on the dashboard* waits for the tile to be drawn, and how long it rings it. */
const SHOW_WITHIN_MS = 10_000;
const RING_MS = 1600;

/**
 * Brings the tile `shown` names into view once `within` draws it, and rings it for a moment. The
 * library's `Dashboard` gives a tile no id in the DOM: it draws the figures (`stat` tiles) in one
 * group and every other tile in another, each in spec order, so the tile is found by its place in
 * its group. Waited for by frames, never past `SHOW_WITHIN_MS`: the relation's fields are read
 * before any tile draws.
 */
function useShowTile(
  within: React.RefObject<HTMLElement | null>,
  shown: AnswerAdded | undefined,
  key: string,
  tiles: readonly { id: string; kind: string }[] | undefined,
) {
  useEffect(() => {
    const tile = shown?.key === key ? tiles?.find((t) => t.id === shown.id) : undefined;
    if (!tile) return;
    const figure = tile.kind === "stat";
    const index = tiles!.filter((t) => (t.kind === "stat") === figure).findIndex((t) => t.id === tile.id);
    const group = figure ? "dashboard-figures" : "dashboard-tiles";
    const until = performance.now() + SHOW_WITHIN_MS;
    let frame = 0;
    let settling: ResizeObserver | undefined;
    const done = new AbortController();
    const find = () => {
      const board = within.current;
      const element = board?.querySelector(`[data-slot="${group}"]`)?.children[index];
      if (!board || !element) {
        if (performance.now() < until) frame = requestAnimationFrame(find);
        return;
      }
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
      element.animate(
        [{ outline: "2px solid var(--color-primary)", outlineOffset: "2px" }, { outline: "2px solid transparent", outlineOffset: "2px" }],
        { duration: RING_MS, easing: "ease-in" },
      );
      // The tiles above it are still drawing, and each one that grows pushes it down: it is kept in
      // view while the board settles, until the reader scrolls for themselves or the time is up.
      settling = new ResizeObserver(() => {
        if (performance.now() > until) return done.abort();
        element.scrollIntoView({ block: "center", behavior: "auto" });
      });
      settling.observe(board);
      for (const type of ["wheel", "touchstart", "keydown"] as const) {
        window.addEventListener(type, () => done.abort(), { signal: done.signal, passive: true });
      }
      done.signal.addEventListener("abort", () => settling?.disconnect());
    };
    find();
    return () => {
      cancelAnimationFrame(frame);
      done.abort();
    };
    // Once per press — `shown` is a new object each time *Open on the dashboard* is pressed — and not
    // again when the reader comes back to the relation later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
}

function SavedDashboard({ relation, onRelationChange, shown }: DashboardViewProps) {
  const graph = useJoinGraph();
  const store = useDashboardStore();
  const board = useRef<HTMLDivElement>(null);

  const key = relationKey(graph, relation);
  useShowTile(board, shown, key, store.status === "ready" ? store.current.byRelation[key]?.tiles : undefined);
  // Each step's key: an identity, which the dashboard draws no tile of.
  const keys = useMemo(() => new JoinResolver(graph).steps(relation).map((step) => step.key), [graph, relation]);

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
      <ScrollArea className="min-h-0 flex-1" ref={board}>
        <Dashboard
          className="p-4"
          exclude={keys}
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
          relation={relation}
          value={current.byRelation[key]}
        />
      </ScrollArea>
    </div>
  );
}
