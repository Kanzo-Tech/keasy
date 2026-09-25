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
import type { WorkspaceRole } from "@/lib/roles";

// ── Types ────────────────────────────────────────────────────────────────────

type RouteDef = {
  name: string;
  icon?: LucideIcon;
  /** Which workspace roles see this in the sidebar. Omit = not in sidebar. */
  sidebar?: readonly WorkspaceRole[];
};

export type RouteEntry = RouteDef & { path: string };

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

// ── Derived ──────────────────────────────────────────────────────────────────

export function findRoute(path: string): RouteEntry | undefined {
  const def = ROUTES[path];
  return def ? { ...def, path } : undefined;
}

export function generateBreadcrumbs(path: string): RouteEntry[] {
  const crumbs: RouteEntry[] = [{ path: "/", name: "Dashboard" }];

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
