import {
  BookOpenCheck,
  Bot,
  Database,
  GalleryVerticalEnd,
  Home,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type RouteDef = {
  name: string;
  icon?: LucideIcon;
  /** Which roles see this in the sidebar. Omit = not in sidebar. */
  sidebar?: readonly ("promotor" | "participant")[];
};

export type RouteEntry = RouteDef & { path: string };

// ── Data ─────────────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<string, string> = {
  promotor: "Promotor",
  org_admin: "Admin",
  org_user: "User",
};

/**
 * Single source of truth — every known route in the app.
 * Keyed by path, O(1) lookup, sidebar/breadcrumbs derive from this.
 */
const ROUTES: Record<string, RouteDef> = {
  "/":                            { name: "Dashboard", icon: Home, sidebar: ["promotor", "participant"] },
  "/connections":                 { name: "Connections", icon: Database, sidebar: ["participant"] },
  "/jobs":                        { name: "Jobs", icon: Workflow, sidebar: ["participant"] },
  "/compliance":                  { name: "Compliance", icon: ShieldCheck, sidebar: ["participant"] },
  "/compliance/wizard":           { name: "Compliance Wizard", icon: ShieldCheck },
  "/participants":                { name: "Participants", icon: Users, sidebar: ["promotor"] },
  "/catalog":                     { name: "Catalog", icon: BookOpenCheck, sidebar: ["promotor"] },
  "/settings":                    { name: "Settings", icon: Settings2 },
  "/settings/ai":                 { name: "AI Settings", icon: Bot },
  "/settings/cloud-accounts":     { name: "Cloud Accounts", icon: GalleryVerticalEnd },
  "/settings/cloud-accounts/new": { name: "New Cloud Account" },
  "/settings/preferences":        { name: "Preferences" },
  "/settings/wallet":             { name: "Wallet" },
  "/org/users":                   { name: "Users" },
  "/org/users/new":               { name: "Add User" },
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
  const key = effectiveRole === "promotor" ? "promotor" : "participant";
  return Object.entries(ROUTES)
    .filter(([, def]) => def.sidebar?.includes(key))
    .map(([path, def]) => ({ ...def, path }));
}
