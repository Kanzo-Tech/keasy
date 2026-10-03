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
export type CrumbLabel = { kind: "job"; id: string };

export type Crumb = RouteEntry & { label?: CrumbLabel };

// ── Data ─────────────────────────────────────────────────────────────────────

/**
 * Single source of truth — every known route in the app.
 * Keyed by path, O(1) lookup, sidebar/breadcrumbs derive from this.
 */
const ROUTES: Record<string, RouteDef> = {
  "/":                            { name: "Dashboard", icon: Home, sidebar: true },
  "/jobs":                        { name: WORDS.graphs, icon: Workflow, sidebar: true },
  "/jobs/new":                    { name: `New ${lower(WORDS.graph)}` },
  "/connections":                 { name: "Connections", icon: Database, sidebar: true },
  // Settings (not in main sidebar — reached via the user menu)
  "/settings":                    { name: "Settings", icon: Settings2 },
  "/settings/preferences":        { name: "Preferences" },
  "/settings/security":           { name: "Security" },
  "/settings/credentials":        { name: "Credentials", icon: KeyRound },
  "/settings/credentials/new":    { name: "New Credential" },
  "/settings/storage":            { name: "Workspace storage", icon: GalleryVerticalEnd },
  "/settings/members":            { name: "Members", icon: Users },
};

/**
 * Routes with a dynamic segment: the name shown until the label resolves, and
 * what to resolve it from. Static routes win, so `/jobs/new` is not a job.
 */
const DYNAMIC: { pattern: RegExp; name: string; label?: (id: string) => CrumbLabel }[] = [
  { pattern: /^\/jobs\/([^/]+)$/, name: WORDS.graph, label: (id) => ({ kind: "job", id }) },
  { pattern: /^\/jobs\/[^/]+\/recipe$/, name: WORDS.recipe },
  { pattern: /^\/jobs\/[^/]+\/discover$/, name: WORDS.explore },
];

// ── Derived ──────────────────────────────────────────────────────────────────

function findRoute(path: string): Crumb | undefined {
  const def = ROUTES[path];
  if (def) return { ...def, path };
  for (const { pattern, name, label } of DYNAMIC) {
    const match = pattern.exec(path);
    if (match) return { path, name, label: label?.(decodeURIComponent(match[1])) };
  }
  return undefined;
}

/**
 * The trail to `path`. `search` is the query it was opened with: the studio opened on a draft
 * (`/jobs/new?draft=…`) edits that graph's recipe, and says so.
 */
export function generateBreadcrumbs(path: string, search?: URLSearchParams): Crumb[] {
  const crumbs: Crumb[] = [{ path: "/", name: "Dashboard" }];
  const draft = path === "/jobs/new" ? search?.get("draft") : null;
  if (draft) {
    return [
      ...crumbs,
      { ...ROUTES["/jobs"], path: "/jobs" },
      { path: `/jobs/${draft}`, name: WORDS.graph, label: { kind: "job", id: draft } },
      { path: `/jobs/new?draft=${draft}`, name: `Edit ${lower(WORDS.recipe)}` },
    ];
  }

  if (path !== "/") {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (let i = 0; i < segments.length; i++) {
      current += `/${segments[i]}`;
      crumbs.push(
        findRoute(current) ?? {
          path: current,
          name: segments[i]
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        },
      );
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
