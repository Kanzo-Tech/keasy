"use client";

import * as React from "react";
import useSWR from "swr";
import { mutate } from "swr";
import { usePathname } from "next/navigation";

import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSidebarRoutes, ROLE_LABEL } from "@/lib/route-config";
import { fetchAuthMe, fetchWorkspaces } from "@/lib/api";
import type { MeResponse, WorkspacesResponse, Workspace } from "@/lib/types";
import { NavMain } from "@/components/layout/nav-main";
import { NavUser } from "@/components/layout/nav-user";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

// Deterministic color from client_id string — matches workspace picker page
function clientIdToColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  const { data: me } = useSWR<MeResponse>("auth-me", fetchAuthMe);

  const { data: workspacesData } = useSWR<WorkspacesResponse>(
    "workspaces",
    fetchWorkspaces,
  );

  const workspaces = workspacesData?.workspaces ?? [];
  const currentClientId = workspacesData?.current_client_id ?? "";
  const isMultiInstance = workspaces.length > 1;
  const currentWorkspace = workspaces.find((ws) => ws.client_id === currentClientId);

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

  // Convert routes to NavMain format with active state
  const navMainItems = sidebarRoutes.map((route) => ({
    title: route.name,
    url: route.path,
    icon: route.icon,
    isActive:
      route.path === "/"
        ? pathname === "/"
        : pathname.startsWith(route.path),
  }));

  const orgName = me?.org?.name ?? "Keasy";

  const [switching, setSwitching] = React.useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = React.useState<string | null>(null);

  // useEffect pattern for window.location.assign — satisfies react-hooks/immutability lint rule
  React.useEffect(() => {
    if (switchTarget === null) return;
    window.location.assign(switchTarget);
  }, [switchTarget]);

  async function handleSwitchInstance(ws: Workspace) {
    setSwitching(ws.name);
    // Clear all SWR cache to prevent stale role/data on return
    await mutate(() => true, undefined, { revalidate: false });
    try {
      setSwitchTarget(`${ws.url}/v1/auth/oidc-start`);
    } catch {
      setSwitching(null);
      toast.error(`Could not switch to ${ws.name}. Please try again.`);
    }
  }

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {switching ? (
              <SidebarMenuButton size="lg" className="cursor-default">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Loader2 className="size-4 animate-spin" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium text-muted-foreground">
                    Switching to {switching}...
                  </span>
                </div>
              </SidebarMenuButton>
            ) : isMultiInstance ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div
                      className="flex aspect-square size-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: clientIdToColor(currentClientId) }}
                    >
                      <span className="text-sm font-bold text-white">
                        {(currentWorkspace?.name ?? orgName).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {currentWorkspace?.name ?? orgName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {ROLE_LABEL[effectiveRole] ?? effectiveRole}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="bottom"
                  align="start"
                  sideOffset={4}
                >
                  {workspaces.map((ws) => (
                    <DropdownMenuItem
                      key={ws.client_id}
                      onClick={() => {
                        if (ws.client_id !== currentClientId) {
                          handleSwitchInstance(ws);
                        }
                      }}
                      className="gap-2"
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: clientIdToColor(ws.client_id) }}
                      />
                      <div className="flex-1 truncate">
                        <span className="text-sm">{ws.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground truncate">
                          {ws.url}
                        </span>
                      </div>
                      {ws.client_id === currentClientId && (
                        <Check className="ml-auto h-4 w-4 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
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
            )}
          </SidebarMenuItem>
        </SidebarMenu>
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
