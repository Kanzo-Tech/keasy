"use client"

import { useState } from "react"
import { ChevronsUpDown, LogOut, Settings } from "lucide-react"
import Link from "next/link"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AvatarFallback,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SidebarIdentity,
  SidebarIdentityAvatar,
  SidebarIdentityDescription,
  SidebarIdentityLabel,
  SidebarIdentityText,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@kanzo-tech/ui"
import { api } from "@/lib/api"

function getInitials(firstName: string, lastName: string, email: string): string {
  if (firstName && lastName) return `${firstName[0]}${lastName[0]}`.toUpperCase();
  if (firstName) return firstName[0].toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    firstName: string
    lastName: string
  }
}) {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const [loggingOut, setLoggingOut] = useState(false)
  // The confirmation is a SIBLING of the menu, not a child: Ark closes the menu on select,
  // which would unmount a dialog nested inside it before it ever painted.
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  const initials = getInitials(user.firstName, user.lastName, user.email)
  const collapsed = state === "collapsed" && !isMobile

  async function handleLogout() {
    setLoggingOut(true)
    try {
      const data = await api.auth.logout()
      if (data?.end_session_url) {
        // Redirect to Keycloak end-session for full single logout
        window.location.href = data.end_session_url
        return
      }
    } catch {
      // Ignore errors — redirect to login regardless
    }
    // Fallback: redirect to OIDC start (no Keycloak end-session URL available)
    window.location.href = "/v1/auth/oidc-start"
  }

  const identity = (
    <>
      <SidebarIdentityAvatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </SidebarIdentityAvatar>
      <SidebarIdentityText>
        <SidebarIdentityLabel>{user.name}</SidebarIdentityLabel>
        <SidebarIdentityDescription>{user.email}</SidebarIdentityDescription>
      </SidebarIdentityText>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Menu positioning={{ placement: isMobile ? "bottom-end" : "right-end", gutter: 4 }}>
          <MenuTrigger asChild>
            {/* `aria-label`, not a tooltip: `asChild` claims the single button node, so a
                nested tooltip trigger would never bind. */}
            <SidebarMenuButton
              aria-label={user.name}
              size="lg"
              className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-full data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <SidebarIdentity collapsed={collapsed} responsive>
                {identity}
              </SidebarIdentity>
              <ChevronsUpDown className="ms-auto group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </MenuTrigger>

          <MenuContent className="w-(--reference-width) min-w-56">
            <div className="px-2 py-1.5">
              {/* No `responsive`: this block is portaled to the body and never collapses
                  with the rail. */}
              <SidebarIdentity>{identity}</SidebarIdentity>
            </div>
            <MenuSeparator />
            <MenuItem asChild value="settings">
              <Link href="/settings" onClick={() => setOpenMobile(false)}>
                <Settings />
                Settings
              </Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onSelect={() => setConfirmingLogout(true)}
              value="log-out"
              variant="destructive"
            >
              <LogOut />
              Log out
            </MenuItem>
          </MenuContent>
        </Menu>

        <AlertDialog
          open={confirmingLogout}
          onOpenChange={(details) => setConfirmingLogout(details.open)}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader
              description="Are you sure you want to log out?"
              title="Log out?"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={loggingOut}
                onClick={handleLogout}
                variant="destructive"
              >
                {loggingOut ? "Logging out..." : "Log out"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
