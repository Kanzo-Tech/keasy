"use client";

import * as React from "react";
import useSWR from "swr";
import { getSidebarRoutes } from "@/lib/route-config";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { TeamSwitcher } from "@/components/team-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";

type MeResponse = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  org: { id: string; name: string } | null;
  dataspaces: { id: string; name: string; role: string }[];
  active_dataspace_id: string | null;
  membership_role: string | null;
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const sidebarRoutes = getSidebarRoutes();

  const { data: me } = useSWR<MeResponse>("auth-me", () =>
    fetch("/api/auth/me").then((r) => r.json()).then((r) => r.data ?? r)
  );

  const user = me
    ? {
        name:
          [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email,
        email: me.email,
        firstName: me.first_name,
        lastName: me.last_name,
      }
    : { name: "", email: "", firstName: "", lastName: "" };

  // Convert routes to NavMain format
  const navMainItems = sidebarRoutes
    .filter((route) => !route.isGroupTitle && route.path)
    .map((route) => ({
      title: route.name,
      url: route.path!,
      icon: route.icon,
      isActive: false,
      ...(route.children?.length
        ? {
            items: route.children
              ?.filter((child) => !child.isGroupTitle && child.path)
              .map((child) => ({
                title: child.name,
                url: child.path!,
              })),
          }
        : {}),
    }));

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher
          dataspaces={me?.dataspaces ?? []}
          activeDataspaceId={me?.active_dataspace_id ?? null}
        />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
