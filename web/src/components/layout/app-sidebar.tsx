"use client";

import * as React from "react";
import { useSession } from "@kanzo-tech/auth";
import { usePathname } from "next/navigation";

import { getSidebarRoutes } from "@/lib/route-config";
import { workspaceRole } from "@/lib/roles";
import { NavMain } from "@/components/layout/nav-main";
import { NavUser } from "@/components/layout/nav-user";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@kanzo-tech/ui";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { session } = useSession();

  const sidebarRoutes = getSidebarRoutes(workspaceRole(session) ?? "member");

  const navMainItems = sidebarRoutes.map((route) => ({
    title: route.name,
    url: route.path,
    icon: route.icon,
    isActive:
      route.path === "/"
        ? pathname === "/"
        : pathname.startsWith(route.path),
  }));

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
