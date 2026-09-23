"use client";

import * as React from "react";
import { useSession } from "@kanzo-tech/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2 } from "lucide-react";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuTrigger,
  Show,
  SidebarIdentity,
  SidebarIdentityDescription,
  SidebarIdentityIcon,
  SidebarIdentityLabel,
  SidebarIdentityText,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  toast,
  useSidebar,
} from "@kanzo-tech/ui";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { workspaceRole } from "@/lib/roles";
import { ROLE_LABEL } from "@/lib/route-config";
import type { WorkspacesResponse } from "@/lib/types";

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
  const { isMobile, state } = useSidebar();
  const queryClient = useQueryClient();
  const { session } = useSession();

  const { data: workspacesData } = useQuery<WorkspacesResponse>({
    queryKey: queryKeys.workspaces,
    queryFn: api.auth.workspaces,
  });

  const workspaces = workspacesData?.workspaces ?? [];
  const current = workspacesData?.current ?? "";

  const effectiveRole = workspaceRole(session) ?? "member";
  // This instance's display name comes from its workspace identity; others show the slug.
  const displayName = workspacesData?.current_name || titleCase(current) || "Keasy";
  const collapsed = state === "collapsed" && !isMobile;

  const [switching, setSwitching] = React.useState<string | null>(null);

  async function handleSwitch(slug: string) {
    if (slug === current) return;
    setSwitching(titleCase(slug));
    try {
      await queryClient.resetQueries();
      // Each workspace is its own instance with its own BFF; signing in there is
      // what the other instance's `/api/auth/signin` does.
      window.location.assign(`${workspaceUrl(slug, current)}/api/auth/signin`);
    } catch {
      setSwitching(null);
      toast.create({
        title: `Could not switch to ${titleCase(slug)}. Please try again.`,
        type: "error",
      });
    }
  }

  if (switching) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default">
            <SidebarIdentity collapsed={collapsed} responsive>
              <SidebarIdentityIcon>
                <Loader2 className="animate-spin" />
              </SidebarIdentityIcon>
              <SidebarIdentityText>
                <SidebarIdentityLabel className="text-muted-foreground">
                  Switching to {switching}…
                </SidebarIdentityLabel>
              </SidebarIdentityText>
            </SidebarIdentity>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const identity = (
    <>
      <SidebarIdentityIcon>
        <GalleryVerticalEnd />
      </SidebarIdentityIcon>
      <SidebarIdentityText>
        <SidebarIdentityLabel>{displayName}</SidebarIdentityLabel>
        <SidebarIdentityDescription>
          {ROLE_LABEL[effectiveRole] ?? effectiveRole}
        </SidebarIdentityDescription>
      </SidebarIdentityText>
    </>
  );

  if (workspaces.length <= 1) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default">
            <SidebarIdentity collapsed={collapsed} responsive>
              {identity}
            </SidebarIdentity>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu positioning={{ placement: isMobile ? "bottom-start" : "right-start", gutter: 4 }}>
          <MenuTrigger asChild>
            <SidebarMenuButton
              aria-label={displayName}
              size="lg"
              className="group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <SidebarIdentity collapsed={collapsed} responsive>
                {identity}
              </SidebarIdentity>
              <ChevronsUpDown className="ms-auto group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </MenuTrigger>
          {/* `--reference-width` is the trigger's width, exposed by Ark on the positioner. */}
          <MenuContent className="w-(--reference-width) min-w-56">
            <MenuGroup heading="Workspaces">
              {workspaces.map((slug) => (
                <MenuItem key={slug} onSelect={() => handleSwitch(slug)} value={slug}>
                  <SidebarIdentity>
                    <SidebarIdentityIcon>
                      <span className="font-bold text-xs">
                        {slug.charAt(0).toUpperCase()}
                      </span>
                    </SidebarIdentityIcon>
                    <SidebarIdentityText>
                      <SidebarIdentityLabel>{titleCase(slug)}</SidebarIdentityLabel>
                    </SidebarIdentityText>
                  </SidebarIdentity>
                  <Show when={slug === current}>
                    <Check className="ms-auto" />
                  </Show>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuContent>
        </Menu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
