"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";

import { getSidebarRoutes } from "@/lib/route-config";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { MeResponse } from "@/lib/types";
import { NavMain } from "@/components/layout/nav-main";
import { NavUser } from "@/components/layout/nav-user";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { data: me } = useQuery<MeResponse>({ queryKey: queryKeys.me, queryFn: api.auth.me });

  const effectiveRole = me?.effective_role ?? "org_user";
  const sidebarRoutes = getSidebarRoutes(effectiveRole);

  const user = me
    ? {
        name:
          [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email,
        email: me.email,
        firstName: me.first_name,
        lastName: me.last_name,
      }
    : { name: "", email: "", firstName: "", lastName: "" };

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
        <NavUser user={user} effectiveRole={effectiveRole} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
