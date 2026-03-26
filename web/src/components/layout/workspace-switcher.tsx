"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { ROLE_LABEL } from "@/lib/route-config";
import type { MeResponse, WorkspacesResponse, Workspace } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar();
  const queryClient = useQueryClient();

  const { data: me } = useQuery<MeResponse>({
    queryKey: queryKeys.me,
    queryFn: api.auth.me,
  });
  const { data: workspacesData } = useQuery<WorkspacesResponse>({
    queryKey: queryKeys.workspaces,
    queryFn: api.auth.workspaces,
  });

  const workspaces = workspacesData?.workspaces ?? [];
  const currentClientId = workspacesData?.current_client_id ?? "";
  const currentWorkspace = workspaces.find((ws) => ws.client_id === currentClientId);

  const effectiveRole = me?.effective_role ?? "org_user";
  const orgName = me?.org?.name ?? "Keasy";
  const displayName = currentWorkspace?.name ?? orgName;

  const [switching, setSwitching] = React.useState<string | null>(null);

  async function handleSwitch(ws: Workspace) {
    if (ws.client_id === currentClientId) return;
    setSwitching(ws.name);
    try {
      await queryClient.resetQueries();
      window.location.assign(`${ws.url}/v1/auth/oidc-start`);
    } catch {
      setSwitching(null);
      toast.error(`Could not switch to ${ws.name}. Please try again.`);
    }
  }

  if (switching) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium text-muted-foreground">
                Switching to {switching}…
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (workspaces.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{displayName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {ROLE_LABEL[effectiveRole] ?? effectiveRole}
              </span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span className="text-sm font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[effectiveRole] ?? effectiveRole}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.client_id}
                onClick={() => handleSwitch(ws)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <span className="text-xs font-bold">
                    {ws.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate">{ws.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {ws.url}
                  </span>
                </div>
                {ws.client_id === currentClientId && (
                  <Check className="ml-auto size-4 shrink-0" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
