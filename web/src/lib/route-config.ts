import {
  Bot,
  Building2,
  Database,
  GalleryVerticalEnd,
  Home,
  Settings2,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type RouteDef = {
  name: string;
  icon?: LucideIcon;
  /** Which workspace roles see this in the sidebar. Omit = not in sidebar. */
  sidebar?: readonly ("owner" | "member" | "admin")[];
};

export type RouteEntry = RouteDef & { path: string };

// ── Data ─────────────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * Single source of truth — every known route in the app.
 * Keyed by path, O(1) lookup, sidebar/breadcrumbs derive from this.
 */
const ROUTES: Record<string, RouteDef> = {
  "/":                            { name: "Dashboard", icon: Home, sidebar: ["owner", "member"] },
  "/connections":                 { name: "Connections", icon: Database, sidebar: ["member"] },
  "/jobs":                        { name: "Jobs", icon: Workflow, sidebar: ["member"] },
  "/organization":                    { name: "Organization", icon: Building2 },
  "/organization/details":            { name: "Details" },
  "/organization/users":              { name: "Users", icon: Users },
  "/participants":                { name: "Participants", icon: Users, sidebar: ["owner"] },
  "/settings":                    { name: "Settings", icon: Settings2 },
  "/settings/ai":                 { name: "AI Settings", icon: Bot },
  "/settings/cloud-accounts":     { name: "Cloud Accounts", icon: GalleryVerticalEnd },
  "/settings/cloud-accounts/new": { name: "New Cloud Account" },
  "/settings/preferences":        { name: "Preferences" },
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
      const route = findRoute(current);
      if (route) {
        crumbs.push(route);
      } else if (i === segments.length - 1) {
        crumbs.push({
          path: current,
          name: segments[i]
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        });
      }
    }
  }

  return crumbs;
}

export function getSidebarRoutes(effectiveRole?: string): RouteEntry[] {
  const keys: ("owner" | "member" | "admin")[] =
    effectiveRole === "owner"
      ? ["owner"]
      : effectiveRole === "admin"
        ? ["member", "admin"]
        : ["member"];
  return Object.entries(ROUTES)
    .filter(([, def]) => def.sidebar?.some((s) => keys.includes(s)))
    .map(([path, def]) => ({ ...def, path }));
}
