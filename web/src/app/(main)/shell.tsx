"use client";

import { Fragment, useState } from "react";
import { useSession } from "@kanzo-tech/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AvatarFallback,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  isActivePath,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Separator,
  ShellHeader,
  Show,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarIdentity,
  SidebarIdentityAvatar,
  SidebarIdentityDescription,
  SidebarIdentityIcon,
  SidebarIdentityLabel,
  SidebarIdentityText,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@kanzo-tech/ui";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { workspaceRole } from "@/lib/roles";
import { generateBreadcrumbs, getSidebarRoutes, ROLE_LABEL } from "@/lib/route-config";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Each workspace is its own subdomain instance: `<current>.<base>` → `<slug>.<base>`.
function workspaceUrl(slug: string, current: string) {
  const { protocol, host } = window.location;
  const [hostname, port] = host.split(":");
  const prefix = current ? `${current}.` : "";
  const base = prefix && hostname.startsWith(prefix) ? hostname.slice(prefix.length) : hostname;
  return `${protocol}//${slug}.${base}${port ? `:${port}` : ""}`;
}

/**
 * The app frame, arranged as the kanzo-ui `app-shell` showcase: workspace switcher, nav and user
 * menu in the rail; trigger and breadcrumbs in the header. Reads `useSidebar()`, so it renders
 * below the provider.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { session, signOut } = useSession();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const [switching, setSwitching] = useState<string | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const { data: workspacesData } = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: api.auth.workspaces,
  });

  const role = workspaceRole(session) ?? "member";
  const routes = getSidebarRoutes(role);
  const crumbs = generateBreadcrumbs(pathname);
  const collapsed = state === "collapsed" && !isMobile;
  const closeMobile = () => setOpenMobile(false);

  const workspaces = workspacesData?.workspaces ?? [];
  const current = workspacesData?.current ?? "";
  const workspaceName = workspacesData?.current_name || titleCase(current) || "Keasy";
  const userName = session?.user.name ?? session?.user.email ?? "";
  const userEmail = session?.user.email ?? "";

  async function switchTo(slug: string) {
    if (slug === current) return;
    setSwitching(titleCase(slug));
    await queryClient.resetQueries();
    // The other instance has its own BFF; its sign-in route is the switch.
    window.location.assign(`${workspaceUrl(slug, current)}/api/auth/signin`);
  }

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <Menu positioning={{ placement: isMobile ? "bottom-start" : "right-start", gutter: 4 }}>
                <MenuTrigger asChild disabled={workspaces.length <= 1 || !!switching}>
                  <SidebarMenuButton
                    aria-label={workspaceName}
                    className="group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    size="lg"
                  >
                    <SidebarIdentity collapsed={collapsed} responsive>
                      <SidebarIdentityIcon>
                        {switching ? <Loader2 className="animate-spin" /> : <GalleryVerticalEnd />}
                      </SidebarIdentityIcon>
                      <SidebarIdentityText>
                        <SidebarIdentityLabel>
                          {switching ? `Switching to ${switching}…` : workspaceName}
                        </SidebarIdentityLabel>
                        <SidebarIdentityDescription>{ROLE_LABEL[role] ?? role}</SidebarIdentityDescription>
                      </SidebarIdentityText>
                    </SidebarIdentity>
                    <Show when={workspaces.length > 1}>
                      <ChevronsUpDown className="ms-auto group-data-[collapsible=icon]:hidden" />
                    </Show>
                  </SidebarMenuButton>
                </MenuTrigger>
                <MenuContent className="w-(--reference-width) min-w-56">
                  <MenuGroup heading="Workspaces">
                    {workspaces.map((slug) => (
                      <MenuItem key={slug} onSelect={() => switchTo(slug)} value={slug}>
                        <SidebarIdentity>
                          <SidebarIdentityIcon>
                            <GalleryVerticalEnd />
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
        </SidebarHeader>

        <SidebarContent>
          <nav aria-label="Platform">
            <SidebarGroup>
              <SidebarGroupLabel>Platform</SidebarGroupLabel>
              <SidebarMenu>
                {routes.map((route) => (
                  <SidebarMenuItem key={route.path}>
                    <SidebarMenuButton
                      asChild
                      isActive={route.path === "/" ? pathname === "/" : isActivePath(pathname, route.path)}
                      tooltip={route.name}
                    >
                      <Link href={route.path} onClick={closeMobile}>
                        {route.icon && <route.icon />}
                        <span className="truncate">{route.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <Menu positioning={{ placement: isMobile ? "bottom-end" : "right-end", gutter: 4 }}>
                <MenuTrigger asChild>
                  <SidebarMenuButton
                    aria-label={userName}
                    className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    size="lg"
                  >
                    <SidebarIdentity collapsed={collapsed} responsive>
                      <SidebarIdentityAvatar>
                        <AvatarFallback>{initials(userName)}</AvatarFallback>
                      </SidebarIdentityAvatar>
                      <SidebarIdentityText>
                        <SidebarIdentityLabel>{userName}</SidebarIdentityLabel>
                        <SidebarIdentityDescription>{userEmail}</SidebarIdentityDescription>
                      </SidebarIdentityText>
                    </SidebarIdentity>
                    <ChevronsUpDown className="ms-auto group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </MenuTrigger>
                <MenuContent className="w-(--reference-width) min-w-56">
                  <div className="px-2 py-1.5">
                    <SidebarIdentity>
                      <SidebarIdentityAvatar>
                        <AvatarFallback>{initials(userName)}</AvatarFallback>
                      </SidebarIdentityAvatar>
                      <SidebarIdentityText>
                        <SidebarIdentityLabel>{userName}</SidebarIdentityLabel>
                        <SidebarIdentityDescription>{userEmail}</SidebarIdentityDescription>
                      </SidebarIdentityText>
                    </SidebarIdentity>
                  </div>
                  <MenuSeparator />
                  <MenuItem asChild value="settings">
                    <Link href="/settings" onClick={closeMobile}>
                      <Settings />
                      Settings
                    </Link>
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onSelect={() => setConfirmingLogout(true)} value="log-out" variant="destructive">
                    <LogOut />
                    Log out
                  </MenuItem>
                </MenuContent>
              </Menu>

              {/* A sibling of the menu: Ark closes the menu on select, which would unmount a
                  dialog nested inside it before it painted. */}
              <AlertDialog
                onOpenChange={(details) => setConfirmingLogout(details.open)}
                open={confirmingLogout}
              >
                <AlertDialogContent size="sm">
                  <AlertDialogHeader description="Are you sure you want to log out?" title="Log out?" />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={loggingOut}
                      onClick={async () => {
                        setLoggingOut(true);
                        await signOut({ returnTo: "/" });
                      }}
                      variant="destructive"
                    >
                      {loggingOut ? "Logging out…" : "Log out"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="overflow-hidden">
        <ShellHeader className="h-12 min-w-0 flex-row items-center gap-2 px-3">
          <SidebarTrigger />
          <Separator className="h-4" orientation="vertical" />
          <Breadcrumb>
            <BreadcrumbList>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.path}>
                  <BreadcrumbItem>
                    {index === crumbs.length - 1 ? (
                      <BreadcrumbPage className="max-w-50 truncate">{crumb.name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild className="max-w-38 truncate">
                        <Link href={crumb.path}>{crumb.name}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {index < crumbs.length - 1 && <BreadcrumbSeparator />}
                </Fragment>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </ShellHeader>
        {children}
      </SidebarInset>
    </>
  );
}
