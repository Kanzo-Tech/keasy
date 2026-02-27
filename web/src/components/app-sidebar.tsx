"use client";

import * as React from "react";
import useSWR from "swr";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { GalleryVerticalEnd, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSidebarRoutes } from "@/lib/route-config";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type MeResponse = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  auth_method: string;
  vc_available: boolean;
  effective_role: string;
  vc_holder_did: string | null;
  wallet_connected_at: string | null;
  org: { id: string; name: string; role: string; vc_verified_at?: string | null } | null;
  membership_role: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  promotor: "Promotor",
  org_admin: "Admin",
  org_user: "User",
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  const { data: me } = useSWR<MeResponse>("auth-me", () =>
    fetch("/api/auth/me").then((r) => r.json()).then((r) => r.data ?? r)
  );

  const effectiveRole = me?.effective_role ?? "org_user";
  const sidebarRoutes = getSidebarRoutes(effectiveRole);

  const user = me
    ? {
        name:
          [me.first_name, me.last_name].filter(Boolean).join(" ") || me.email,
        email: me.email,
        firstName: me.first_name,
        lastName: me.last_name,
        authMethod: me.auth_method,
      }
    : { name: "", email: "", firstName: "", lastName: "" };

  // Convert routes to NavMain format with active state
  const navMainItems = sidebarRoutes
    .filter((route) => !route.isGroupTitle && route.path)
    .map((route) => ({
      title: route.name,
      url: route.path!,
      icon: route.icon,
      isActive:
        route.path === "/"
          ? pathname === "/"
          : pathname.startsWith(route.path!),
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

  const orgName = me?.org?.name ?? "Keasy";

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <GalleryVerticalEnd className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{orgName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[effectiveRole] ?? effectiveRole}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMainItems} />
      </SidebarContent>
      <SidebarFooter>
        {effectiveRole !== "promotor" && (
          <div className="flex items-center justify-center px-2 pb-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/settings/wallet"
                    className="relative inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Wallet className="h-4 w-4" />
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-sidebar-background",
                        me?.vc_holder_did
                          ? "bg-green-500"
                          : "bg-muted-foreground/30"
                      )}
                    />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {me?.vc_holder_did ? "Wallet connected" : "No wallet connected"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
