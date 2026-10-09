"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { type Dashboards, parseDashboards, type Relation } from "@kanzo-tech/ui/analytics";
import { $api, http, type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { toastError } from "@/lib/errors";
import { useCorpus } from "@/lib/fossil/corpus";
import { useDashboardWrites } from "./dashboard-writes";

/**
 * The graph's saved dashboards — one document, a spec per relation — as the page holds them: what
 * the server has, the edit being typed over it, and the write. It is the page's and not the
 * Dashboard view's because two places change it: the view's editor, and the Ask panel's *Add to the
 * dashboard*. One draft for both, so an answer added while a tile is being edited lands on the edit
 * rather than on what the server held before it, and the view then shows the relation it landed on.
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
         * *Add to the dashboard*: `next` saved now, with any pending edit it was made over, and the
         * Dashboard view turned to `relation`. It settles with the write; its failure is the card's
         * to draw, so the page does not toast it.
         */
        add: (next: Dashboards, added: { relation: Relation }) => Promise<unknown>;
      };
    };

/** Saved after a pause, not per edit: dragging a slider is many edits and one decision. */
const SAVE_MS = 800;

const StoreContext = createContext<DashboardStore | null>(null);

export function DashboardStoreProvider({ onAdded, children }: {
  /** The Dashboard view is turned to `relation`, where an answer was just added. */
  onAdded: (relation: Relation) => void;
  children: ReactNode;
}) {
  const { graphId } = useCorpus();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/dashboard", init);
  const saved = $api.useQuery("get", "/v1/graphs/{id}/dashboard", init);
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

  const save = useMutation({
    // One at a time, in the order they were made: an edit flushed before an add lands before it.
    scope: { id: `dashboard ${graphId}` },
    mutationFn: async (spec: Dashboards) => (await http.PUT("/v1/graphs/{id}/dashboard", { ...init, body: { spec: { ...spec } } })).data,
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
  });
  // The editor's failed writes are toasted; an add's is drawn in its card (./dashboard-writes).
  const { draft, change, add: addNow } = useDashboardWrites(stored.spec, {
    write: (spec) => save.mutateAsync(spec),
    report: (err) => toastError(err, "Failed to save the dashboard"),
    delay: SAVE_MS,
  });
  const current = draft !== stored.spec ? draft : save.isPending ? save.variables : draft;

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
            edit: graph.data.can_modify
              ? {
                  change,
                  add: (next, { relation }) => {
                    onAdded(relation);
                    return addNow(next);
                  },
                }
              : undefined,
          };

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useDashboardStore(): DashboardStore {
  const store = use(StoreContext);
  if (!store) throw new Error("useDashboardStore must be used within DashboardStoreProvider");
  return store;
}
