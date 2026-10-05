"use client";

import { Suspense, useState } from "react";
import { useSession } from "@kanzo-tech/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, GalleryVerticalEnd, Loader2, LogOut, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AvatarFallback,
  isActivePath,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Separator,
  ShellHeader,
  ShellMain,
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

import { Link } from "@kanzo-tech/navigation/next";
import { useBranding } from "@/lib/branding-context";
import { displayRole, ROLE_LABEL, switchable, type Role } from "@/lib/auth/roles";
import { ProblemView } from "@/components/problem-view";
import { initials } from "@/lib/ui/format";
import { generateBreadcrumbs, getSidebarRoutes } from "@/app/(main)/_parts/route-config";
import { HeaderEndContext } from "@/app/(main)/_parts/header-end";
import { SearchTrail, Trail } from "@/app/(main)/_parts/trail";

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Each workspace is its own subdomain instance, named for its organization: `<current>.<base>` → `<slug>.<base>`.
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
  const { session, status, error, signOut } = useSession();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [headerEnd, setHeaderEnd] = useState<HTMLElement | null>(null);

  const role = displayRole(session);
  const routes = getSidebarRoutes();
  const crumbs = generateBreadcrumbs(pathname);
  const collapsed = state === "collapsed" && !isMobile;
  const closeMobile = () => setOpenMobile(false);

  const userName = session?.user.name ?? session?.user.email ?? "";
  const userEmail = session?.user.email ?? "";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <WorkspaceSwitcher collapsed={collapsed} isMobile={isMobile} role={role} />
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
                        try {
                          await signOut({ returnTo: "/" });
                        } finally {
                          // Signing out navigates away; if it fails instead, the button comes back.
                          setLoggingOut(false);
                        }
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
          <Suspense fallback={<Trail crumbs={crumbs} />}>
            <SearchTrail pathname={pathname} />
          </Suspense>
          <div className="ms-auto flex items-center gap-2 empty:hidden" ref={setHeaderEnd} />
        </ShellHeader>
        <HeaderEndContext value={headerEnd}>
          {/* A session that could not be read is an outage, not a sign-out: say it, by its code. */}
          {status === "failed" ? (
            <ShellMain className="items-center justify-center p-4">
              <ProblemView className="w-full max-w-xl" error={error} />
            </ShellMain>
          ) : (
            children
          )}
        </HeaderEndContext>
      </SidebarInset>
    </>
  );
}

/**
 * The rail's workspace identity: this workspace's name and the caller's role here. The rest of the
 * props reach the button, so a `MenuTrigger asChild` can make it the trigger.
 */
function WorkspaceButton({
  name,
  logo,
  held,
  collapsed,
  switching,
  many = false,
  ...trigger
}: {
  name: string;
  /** The operator's mark (`/v1/branding`); the generic icon without one. */
  logo?: string | null;
  /** The caller's widest role here; no badge without one. */
  held: Role | null;
  collapsed: boolean;
  switching?: string | null;
  many?: boolean;
} & Omit<React.ComponentProps<typeof SidebarMenuButton>, "children">) {
  return (
    <SidebarMenuButton
      {...trigger}
      aria-label={name}
      className="group-data-[collapsible=icon]:justify-center data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      size="lg"
    >
      <SidebarIdentity collapsed={collapsed} responsive>
        <SidebarIdentityIcon>
          {switching ? (
            <Loader2 className="animate-spin" />
          ) : logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- an operator-declared URL, not a bundled asset
            <img alt="" className="size-full object-contain" src={logo} />
          ) : (
            <GalleryVerticalEnd />
          )}
        </SidebarIdentityIcon>
        <SidebarIdentityText>
          <SidebarIdentityLabel>{switching ? `Switching to ${switching}…` : name}</SidebarIdentityLabel>
          {held && <SidebarIdentityDescription>{ROLE_LABEL[held]}</SidebarIdentityDescription>}
        </SidebarIdentityText>
      </SidebarIdentity>
      <Show when={many}>
        <ChevronsUpDown className="ms-auto group-data-[collapsible=icon]:hidden" />
      </Show>
    </SidebarMenuButton>
  );
}

/** The organizations the caller holds a role in, as a menu that switches instance. */
function WorkspaceSwitcher({ role, collapsed, isMobile }: { role: Role | null; collapsed: boolean; isMobile: boolean }) {
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);
  const branding = useBranding();
  const { session } = useSession();
  const current = branding.organization;
  const workspaces = switchable(session).map((o) => o.alias);
  const workspaceName = branding.name || titleCase(current) || "Keasy";

  async function switchTo(slug: string) {
    if (slug === current) return;
    setSwitching(titleCase(slug));
    await queryClient.resetQueries();
    // The other instance has its own BFF, which signs the person in on arrival.
    window.location.assign(`${workspaceUrl(slug, current)}/`);
  }

  return (
    <Menu positioning={{ placement: isMobile ? "bottom-start" : "right-start", gutter: 4 }}>
      <MenuTrigger asChild disabled={workspaces.length <= 1 || !!switching}>
        <WorkspaceButton
          collapsed={collapsed}
          logo={branding.logo}
          many={workspaces.length > 1}
          name={workspaceName}
          held={role}
          switching={switching}
        />
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
  );
}
