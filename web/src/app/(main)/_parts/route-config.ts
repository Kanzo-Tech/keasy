import {
  Boxes,
  Database,
  GalleryVerticalEnd,
  Home,
  KeyRound,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceRole } from "@/lib/auth/roles";

// ── Types ────────────────────────────────────────────────────────────────────

type RouteDef = {
  name: string;
  icon?: LucideIcon;
  /** Which workspace roles see this in the sidebar. Omit = not in sidebar. */
  sidebar?: readonly WorkspaceRole[];
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
  // Shared
  "/":                            { name: "Dashboard", icon: Home, sidebar: ["owner", "member"] },
  // Member plane (data)
  "/connections":                 { name: "Connections", icon: Database, sidebar: ["member"] },
  "/jobs":                        { name: "Jobs", icon: Workflow, sidebar: ["member"] },
  "/jobs/new":                    { name: "New Job" },
  // Owner plane (metadata)
  "/datasets":                    { name: "Data Catalog", icon: Boxes, sidebar: ["owner"] },
  "/catalog":                     { name: "Catalog Storage", icon: GalleryVerticalEnd, sidebar: ["owner"] },
  // Settings (not in main sidebar — reached via the user menu)
  "/settings":                    { name: "Settings", icon: Settings2 },
  "/settings/preferences":        { name: "Preferences" },
  "/settings/security":           { name: "Security" },
  "/settings/credentials":        { name: "Credentials", icon: KeyRound },
  "/settings/credentials/new":    { name: "New Credential" },
};

/**
 * Routes with a dynamic segment: the name shown until the label resolves, and
 * what to resolve it from. Static routes win, so `/jobs/new` is not a job.
 */
const DYNAMIC: { pattern: RegExp; name: string; label: (id: string) => CrumbLabel }[] = [
  { pattern: /^\/jobs\/([^/]+)$/, name: "Job", label: (id) => ({ kind: "job", id }) },
];

// ── Derived ──────────────────────────────────────────────────────────────────

function findRoute(path: string): Crumb | undefined {
  const def = ROUTES[path];
  if (def) return { ...def, path };
  for (const { pattern, name, label } of DYNAMIC) {
    const match = pattern.exec(path);
    if (match) return { path, name, label: label(decodeURIComponent(match[1])) };
  }
  return undefined;
}

export function generateBreadcrumbs(path: string): Crumb[] {
  const crumbs: Crumb[] = [{ path: "/", name: "Dashboard" }];

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

export function getSidebarRoutes(role: WorkspaceRole): RouteEntry[] {
  // Two disjoint planes: the member sees the data surface, the owner sees the
  // metadata/people surface. Each role sees only its own plane (plus Dashboard).
  return Object.entries(ROUTES)
    .filter(([, def]) => def.sidebar?.includes(role))
    .map(([path, def]) => ({ ...def, path }));
}
