"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { type Dashboards, parseDashboards } from "@kanzo-tech/ui/analytics";
import type { AnswerAdded } from "@kanzo-tech/ai/data";
import { $api, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { toastError } from "@/lib/errors";
import { useParams } from "next/navigation";
import { useDashboardWrites } from "./dashboard-writes";

/**
 * The graph's saved dashboards — one document, a spec per relation — as the page holds them: what
 * the server has, the edit being typed over it, and the write. It is the page's and not the
 * Dashboard view's because two places change it: the view's editor, and the Ask panel's *Add to the
 * dashboard*. One draft for both, so an answer added while a tile is being edited lands on the edit
 * rather than on what the server held before it. *Open on the dashboard* is the page's to do: it
 * owns the view and the relation.
 *
 * The reads are not suspended: a dashboard that fails to read fails in the Dashboard view, as it
 * did when the view read it, and leaves the graph and the dock drawn.
 */
export type DashboardStore =
  | { status: "pending" }
  | { status: "error"; error: unknown; retry: () => void }
  | {
      status: "ready";
      /** The saved document's provenance, or `null` while nobody has saved one. */
      saved: Schemas["Dashboard"] | null;
      /** What is on screen: the edit being typed, else what is being written, else what the server holds. */
      current: Dashboards;
      /** Present only for whoever may change the graph: everyone reads the dashboard, they edit it. */
      edit?: {
        /** An edit in the editor, saved once editing pauses. */
        change: (next: Dashboards) => void;
        /**
         * *Add to the dashboard*: `next` saved now, with any pending edit it was made over. It only
         * writes — the reader stays where they asked — and settles with the write; its failure is
         * the card's to draw, so the page does not toast it.
         */
        add: (next: Dashboards) => Promise<unknown>;
        /** *Open on the dashboard*: the Dashboard view, on the relation the tile was added to, showing it. */
        open: (added: AnswerAdded) => void;
      };
    };

/** Saved after a pause, not per edit: dragging a slider is many edits and one decision. */
const SAVE_MS = 800;

const StoreContext = createContext<DashboardStore | null>(null);

export function DashboardStoreProvider({ onOpen, children }: {
  /** The page shows the Dashboard view on `added.relation`, and brings the tile `added.id` into view. */
  onOpen: (added: AnswerAdded) => void;
  children: ReactNode;
}) {
  const { id: graphId } = useParams<{ id: string }>();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/dashboard", init);
  // eslint-disable-next-line no-restricted-properties -- a failed read is drawn in the Dashboard view, and the graph and the dock stay
  const saved = $api.useQuery("get", "/v1/graphs/{id}/dashboard", init);
  // eslint-disable-next-line no-restricted-properties -- as above: the page holds the graph for the whole of it
  const graph = $api.useQuery("get", "/v1/graphs/{id}", init);

  // What the server holds, checked whole: a document an earlier release wrote is refused, not
  // migrated, and the Dashboard view shows why.
  const stored = useMemo((): { spec?: Dashboards; error?: unknown } => {
    if (saved.data === undefined) return {};
    try {
      return { spec: parseDashboards(saved.data?.spec) };
    } catch (error) {
      return { error };
    }
  }, [saved.data]);

  const save = $api.useMutation("put", "/v1/graphs/{id}/dashboard", {
    // One at a time, in the order they were made: an edit flushed before an add lands before it.
    scope: { id: `dashboard ${graphId}` },
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
  });
  // The editor's failed writes are toasted; an add's is drawn in its card (./dashboard-writes).
  const { draft, change, add: addNow } = useDashboardWrites(stored.spec, {
    write: (spec) => save.mutateAsync({ ...init, body: { spec: { ...spec } } }),
    report: (err) => toastError(err, "Failed to save the dashboard"),
    delay: SAVE_MS,
  });
  const current = draft !== stored.spec ? draft : save.isPending ? (save.variables?.body.spec as Dashboards | undefined) : draft;

  const error = saved.error ?? graph.error ?? stored.error;
  const store: DashboardStore =
    error != null
      ? {
          status: "error",
          error,
          retry: () => {
            void saved.refetch();
            void graph.refetch();
          },
        }
      : current === undefined || saved.data === undefined || graph.data === undefined
        ? { status: "pending" }
        : {
            status: "ready",
            saved: saved.data,
            current,
            edit: graph.data.can.manage
              ? { change, add: addNow, open: onOpen }
              : undefined,
          };

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useDashboardStore(): DashboardStore {
  const store = use(StoreContext);
  if (!store) throw new Error("useDashboardStore must be used within DashboardStoreProvider");
  return store;
}
