"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { ROLE_LABEL } from "@/lib/route-config";
import type { MeResponse, WorkspacesResponse } from "@/lib/types";
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

// Each tenant is its own subdomain instance. The switcher gets only slugs (from the
// `workspaces` token claim) and `current`; it builds each workspace's URL from the
// current hostname by swapping the leading subdomain (`<current>.<base>` → `<slug>.<base>`).
function workspaceUrl(slug: string, current: string): string {
  const { protocol, host } = window.location;
  const [hostname, port] = host.split(":");
  const prefix = current ? `${current}.` : "";
  const base =
    prefix && hostname.startsWith(prefix) ? hostname.slice(prefix.length) : hostname;
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ""}`;
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  const current = workspacesData?.current ?? "";

  const effectiveRole = me?.effective_role ?? "member";
  // This instance's display name comes from its workspace identity; others show the slug.
  const displayName = me?.org?.name ?? titleCase(current) ?? "Keasy";

  const [switching, setSwitching] = React.useState<string | null>(null);

  async function handleSwitch(slug: string) {
    if (slug === current) return;
    setSwitching(titleCase(slug));
    try {
      await queryClient.resetQueries();
      window.location.assign(`${workspaceUrl(slug, current)}/v1/auth/oidc-start`);
    } catch {
      setSwitching(null);
      toast.error(`Could not switch to ${titleCase(slug)}. Please try again.`);
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
            {workspaces.map((slug) => (
              <DropdownMenuItem
                key={slug}
                onClick={() => handleSwitch(slug)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <span className="text-xs font-bold">
                    {slug.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate">{titleCase(slug)}</span>
                </div>
                {slug === current && <Check className="ml-auto size-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
