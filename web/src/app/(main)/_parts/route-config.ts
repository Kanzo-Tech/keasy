import {
  Database,
  GalleryVerticalEnd,
  Home,
  KeyRound,
  Settings2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { lower, WORDS } from "@/lib/vocabulary";

// ── Types ────────────────────────────────────────────────────────────────────

type RouteDef = {
  name: string;
  icon?: LucideIcon;
  /** In the sidebar, for every role. */
  sidebar?: true;
};

type RouteEntry = RouteDef & { path: string };

/** What a dynamic segment's crumb names, looked up when it renders. */
export type CrumbLabel = { kind: "graph"; id: string };

export type Crumb = RouteEntry & { label?: CrumbLabel };

// ── Data ─────────────────────────────────────────────────────────────────────

/**
 * Single source of truth — every known route in the app.
 * Keyed by path, O(1) lookup, sidebar/breadcrumbs derive from this.
 */
const ROUTES: Record<string, RouteDef> = {
  "/":                            { name: "Dashboard", icon: Home, sidebar: true },
  "/graphs":                        { name: WORDS.graphs, icon: Workflow, sidebar: true },
  "/graphs/new":                    { name: `New ${lower(WORDS.graph)}` },
  "/graphs/new/assistant":          { name: `New ${lower(WORDS.graph)}` },
  "/connections":                 { name: "Connections", icon: Database, sidebar: true },
  "/connections/new":             { name: "New connection" },
  // Settings (not in main sidebar — reached via the user menu)
  "/settings":                    { name: "Settings", icon: Settings2 },
  "/settings/preferences":        { name: "Preferences" },
  "/settings/security":           { name: "Security" },
  "/settings/credentials":        { name: "Credentials", icon: KeyRound },
  "/settings/credentials/new":    { name: "New credential" },
  "/settings/storage":            { name: "Workspace storage", icon: GalleryVerticalEnd },
  "/settings/members":            { name: "Members", icon: Users },
};

/**
 * Routes with a dynamic segment: the name shown until the label resolves, and
 * what to resolve it from. Static routes win, so `/graphs/new` is not a graph.
 * A connection and a credential are keyed by their name, so the segment is it.
 */
const DYNAMIC: { pattern: RegExp; name: string | ((id: string) => string); label?: (id: string) => CrumbLabel }[] = [
  { pattern: /^\/graphs\/([^/]+)$/, name: WORDS.graph, label: (id) => ({ kind: "graph", id }) },
  { pattern: /^\/graphs\/[^/]+\/discover$/, name: WORDS.explore },
  { pattern: /^\/connections\/([^/]+)$/, name: (name) => name },
  { pattern: /^\/settings\/credentials\/([^/]+)$/, name: (name) => name },
];

// ── Derived ──────────────────────────────────────────────────────────────────

function findRoute(path: string): Crumb | undefined {
  const def = ROUTES[path];
  if (def) return { ...def, path };
  for (const { pattern, name, label } of DYNAMIC) {
    const match = pattern.exec(path);
    if (!match) continue;
    const id = match[1] === undefined ? "" : decodeURIComponent(match[1]);
    return { path, name: typeof name === "function" ? name(id) : name, label: label?.(id) };
  }
  return undefined;
}

/**
 * The trail to `path`. `search` is the query it was opened with: the studio opened on a draft
 * (`/graphs/new?draft=…`) edits that graph's recipe, and says so; the assistant's
 * (`/graphs/new/assistant?graph=…`) names the graph its conversation built.
 */
export function generateBreadcrumbs(path: string, search?: URLSearchParams): Crumb[] {
  const crumbs: Crumb[] = [{ path: "/", name: "Dashboard" }];
  const draft = path === "/graphs/new" ? search?.get("draft") : null;
  if (draft) {
    return [
      ...crumbs,
      { ...ROUTES["/graphs"], path: "/graphs" },
      { path: `/graphs/${draft}`, name: WORDS.graph, label: { kind: "graph", id: draft } },
      { path: `/graphs/new?draft=${draft}`, name: `Edit ${lower(WORDS.recipe)}` },
    ];
  }

  // The assistant is one page: *New graph*, and once its conversation has built one, that graph's name.
  if (path === "/graphs/new/assistant") {
    const built = search?.get("graph");
    return [
      ...crumbs,
      { ...ROUTES["/graphs"], path: "/graphs" },
      built ? { path: `/graphs/${built}`, name: WORDS.graph, label: { kind: "graph", id: built } } : { ...ROUTES[path], path },
    ];
  }

  if (path !== "/") {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < segments.length; i++) {
      current += `/${segments[i]}`;
      // A path the route table does not know has no crumb: the URL is not a name.
      const crumb = findRoute(current);
      if (crumb) crumbs.push(crumb);
    }
  }

  return crumbs;
}

/** The sidebar is the same for every role: the work is shared, and what a role may change is drawn on the page. */
export function getSidebarRoutes(): RouteEntry[] {
  return Object.entries(ROUTES)
    .filter(([, def]) => def.sidebar)
    .map(([path, def]) => ({ ...def, path }));
}
