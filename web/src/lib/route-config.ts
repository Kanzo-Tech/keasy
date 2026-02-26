import {
  Bot,
  Database,
  Frame,
  GalleryVerticalEnd,
  Home,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type RouteConfig = {
  path: string;
  name: string;
  icon?: LucideIcon;
  children?: RouteConfig[];
  showInSidebar?: boolean;
  isGroupTitle?: boolean;
};

export const mainRouteConfig: RouteConfig[] = [
  {
    path: "/",
    name: "Home",
    icon: Home,
    showInSidebar: true,
  },
  {
    path: "/connections",
    name: "Connections",
    icon: Database,
    showInSidebar: true,
  },
  {
    path: "/jobs",
    name: "Jobs",
    icon: Workflow,
    showInSidebar: true,
  },
];

export const routeConfig: RouteConfig[] = [
  ...mainRouteConfig,
  {
    path: "/settings",
    name: "Settings",
    icon: Settings2,
    showInSidebar: false,
  },
  {
    path: "/settings/ai",
    name: "AI Settings",
    icon: Bot,
    showInSidebar: false,
  },
  {
    path: "/settings/cloud-accounts",
    name: "Cloud Accounts",
    icon: GalleryVerticalEnd,
    showInSidebar: false,
    children: [
      {
        path: "/settings/cloud-accounts/new",
        name: "New Cloud Account",
        showInSidebar: false,
      },
      {
        path: "/settings/cloud-accounts/[id]",
        name: "Cloud Account Details",
        showInSidebar: false,
      },
    ],
  },
  {
    path: "/settings/organization",
    name: "Organization",
    icon: Frame,
    showInSidebar: false,
  },
  {
    path: "/settings/preferences",
    name: "Preferences",
    icon: Settings2,
    showInSidebar: false,
  },
  {
    path: "/admin/dataspaces/new",
    name: "Create Dataspace",
    showInSidebar: false,
  },
  {
    path: "/admin/organizations",
    name: "Organizations",
    showInSidebar: false,
  },
  {
    path: "/org/users",
    name: "Users",
    showInSidebar: false,
  },
  {
    path: "/org/users/new",
    name: "Add User",
    showInSidebar: false,
  },
];

export function findRouteByPath(path: string): RouteConfig | undefined {
  const checkRoute = (routes: RouteConfig[]): RouteConfig | undefined => {
    for (const route of routes) {
      if (route.path === path) {
        return route;
      }
      if (route.children) {
        const foundInChildren = checkRoute(route.children);
        if (foundInChildren) {
          return foundInChildren;
        }
      }
    }
    return undefined;
  };

  return checkRoute(routeConfig);
}

export function generateBreadcrumbs(path: string): RouteConfig[] {
  const breadcrumbs: RouteConfig[] = [];
  const pathSegments = path.split("/").filter(Boolean);
  let currentPath = "";

  breadcrumbs.push({
    path: "/",
    name: "Home",
  });

  if (path !== "/") {
    for (let i = 0; i < pathSegments.length; i++) {
      currentPath += `/${pathSegments[i]}`;

      const route = findRouteByPath(currentPath);

      if (route) {
        breadcrumbs.push(route);
      } else if (i === pathSegments.length - 1) {
        breadcrumbs.push({
          path: currentPath,
          name: pathSegments[i]
            .replace(/-/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        });
      }
    }
  }

  return breadcrumbs;
}

export function getSidebarRoutes(): RouteConfig[] {
  return routeConfig.filter((route) => route.showInSidebar);
}
