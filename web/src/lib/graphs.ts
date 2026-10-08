import type { Badge } from "@kanzo-tech/ui";
import type { Schemas } from "@/lib/api/client";
import type { Wire } from "@/lib/errors";
import { lower, WORDS } from "@/lib/vocabulary";

type Graph = Schemas["Graph"];
type GraphStatus = Schemas["GraphStatus"];

/** How each status reads, in the list and on the page alike. */
export const STATUS: Record<GraphStatus, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  draft: { label: "Draft", variant: "secondary" },
  idle: { label: "Ready", variant: "secondary" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

/** Whether a run is under way: the one status a page polls for, since it ends on its own. */
export function isRunning(status: GraphStatus): boolean {
  return status === "running";
}

export function hasRunningGraphs(graphs: Graph[] | undefined): boolean {
  return graphs?.some((j) => isRunning(j.status)) ?? false;
}

/**
 * How often a page asks after a run under way: soon enough that a finished run shows within a
 * breath, and a tenth of a request a second against the server's twenty per caller.
 */
export const GRAPH_POLL_MS = 2_000;

/**
 * A `refetchInterval` that polls every {@link GRAPH_POLL_MS} while `running(data)`, and stops once the
 * query is in error — a dead API is not asked forever, and the failure, not the last good answer,
 * is shown.
 */
export function pollWhile<T>(running: (data: T | undefined) => boolean) {
  return (query: { state: { status: string; data: T | undefined } }): number | false =>
    query.state.status !== "error" && running(query.state.data) ? GRAPH_POLL_MS : false;
}

/** Why a failed run failed: the problem the browser stored, opaque to the server. */
export function runProblem(graph: Graph): Wire | null {
  return (graph.problem as Wire | undefined) ?? null;
}

/** What the header's one primary slot holds. */
export type PrimaryKind = "edit" | "run" | "stop" | "recover" | "explore" | "run-again";

export interface Primary {
  kind: PrimaryKind;
  label: string;
  /** Why it cannot be done now; unset when it can. */
  blocked?: string;
}

export interface Viewer {
  /** The caller holds editor here: whether they could ever edit, run or stop a graph. */
  editor: boolean;
  /** The caller's `sub`. */
  me: string | undefined;
  /** This tab runs the graph now. */
  runsHere: boolean;
}

const NO_OUTPUT = `No ${lower(WORDS.output)} yet`;
const NOT_YOURS = `Only its creator or an admin can change this ${lower(WORDS.graph)}`;

/**
 * The header's primary action for `graph`, as `viewer` sees it. What the role can never do is not
 * offered — a reader is shown Explore, disabled until there is output; what cannot be done now is
 * offered disabled, with the reason.
 */
export function primaryAction(graph: Graph, { editor, me, runsHere }: Viewer): Primary {
  const explore: Primary = { kind: "explore", label: WORDS.explore };
  if (graph.status === "completed") return explore;
  if (!editor) return { ...explore, blocked: NO_OUTPUT };
  const mine = (p: Primary): Primary => (graph.can_modify ? p : { ...p, blocked: NOT_YOURS });
  switch (graph.status) {
    case "draft":
      return mine({ kind: "edit", label: `Edit ${lower(WORDS.recipe)}` });
    case "idle":
      return mine({ kind: "run", label: WORDS.run });
    case "failed":
    case "cancelled":
      return mine({ kind: "run-again", label: `${WORDS.run} again` });
    case "running": {
      const stop: Primary = { kind: "stop", label: "Stop" };
      if (runsHere) return graph.cancel_requested ? { ...stop, blocked: "Stopping…" } : stop;
      // The run is ours, and no tab of this page runs it: the tab that did reloaded or closed.
      if (me && graph.runner?.id === me) return { kind: "recover", label: `Mark failed and ${lower(WORDS.run)} again` };
      if (!graph.can_stop) return { ...stop, blocked: "Only whoever runs it, or an admin, can stop it" };
      return graph.cancel_requested ? { ...stop, blocked: "Stopping…" } : stop;
    }
  }
}
