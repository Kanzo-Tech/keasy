import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";

/**
 * What Discovery shows is in its URL, so a link opens it as it was left: `?view=` is the main
 * region (`graph` · `dashboard`) and `?panel=` what the dock holds (`info` · `ask` · `rules` ·
 * `settings`), or `none` while it is collapsed.
 *
 * A parameter that is absent is the view's default, and the URL carries only what differs from it:
 * Graph view with Info in the dock is the bare `/graphs/{id}/discover`, and a dashboard, judged at full
 * width, opens with the dock collapsed. So `?view=dashboard` is the dashboard alone, `?panel=none`
 * the graph alone, and `?view=dashboard&panel=rules` the dashboard beside its rules. A value the page
 * does not know is read as absent.
 */

export const VIEW_IDS = ["graph", "dashboard"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const PANEL_IDS = ["info", "ask", "rules", "settings"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** What the dock holds: a panel, or `none` while it is collapsed. */
export type Dock = PanelId | "none";

export interface DiscoverState {
  view: ViewId;
  panel: Dock;
}

/** What the dock holds in `view` when the URL does not say. */
export function defaultPanel(view: ViewId): Dock {
  return view === "dashboard" ? "none" : "info";
}

const isView = (value: string | null): value is ViewId => VIEW_IDS.includes(value as ViewId);
const isDock = (value: string | null): value is Dock => value === "none" || PANEL_IDS.includes(value as PanelId);

/** The state a URL's query names. */
export function readDiscoverState(params: Pick<URLSearchParams, "get">): DiscoverState {
  const raw = params.get("view");
  const view = isView(raw) ? raw : "graph";
  const panel = params.get("panel");
  return { view, panel: isDock(panel) ? panel : defaultPanel(view) };
}

/** `params` with `state` in place of what it named, every other parameter kept. */
export function writeDiscoverState(params: URLSearchParams, state: DiscoverState): URLSearchParams {
  const next = new URLSearchParams(params);
  if (state.view === "graph") next.delete("view");
  else next.set("view", state.view);
  if (state.panel === defaultPanel(state.view)) next.delete("panel");
  else next.set("panel", state.panel);
  return next;
}

/**
 * Discovery's view and dock, read from the URL and written to it in place. The write is the
 * History API's `replaceState`, which the App Router keeps `useSearchParams` in step with: a router
 * navigation would fetch the page's segment from the server for each press of a panel icon, and
 * the dock would wait on it. Replaced rather than pushed, so Back leaves Discovery instead of
 * walking back through every panel the reader looked at.
 */
export function useDiscoverState(): [DiscoverState, (change: Partial<DiscoverState>) => void] {
  const params = useSearchParams();
  const state = useMemo(() => readDiscoverState(params), [params]);
  const set = useCallback((change: Partial<DiscoverState>) => {
    // From the location rather than the last render, so two writes in one event both land.
    const current = new URLSearchParams(window.location.search);
    const next = writeDiscoverState(current, { ...readDiscoverState(current), ...change });
    if (next.toString() === current.toString()) return;
    const query = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);
  return [state, set];
}
