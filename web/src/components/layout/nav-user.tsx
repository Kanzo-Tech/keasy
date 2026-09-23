"use client"

import { useState } from "react"
import { useSession } from "@kanzo-tech/auth"
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

function getInitials(name: string | undefined, email: string | undefined): string {
  const parts = (name ?? "").split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (email?.[0] ?? "?").toUpperCase()
}

export function NavUser() {
  const { isMobile, setOpenMobile, state } = useSidebar()
  const { session, signOut } = useSession()
  const [loggingOut, setLoggingOut] = useState(false)
  // The confirmation is a SIBLING of the menu, not a child: Ark closes the menu on select,
  // which would unmount a dialog nested inside it before it ever painted.
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  const name = session?.user.name ?? session?.user.email ?? ""
  const email = session?.user.email ?? ""
  const initials = getInitials(session?.user.name, session?.user.email)
  const collapsed = state === "collapsed" && !isMobile

  // RP-initiated logout: the BFF forgets the session, clears the cookie and ends
  // it at Keycloak too, `id_token_hint` included. No end-session URL is built
  // here — the endpoint comes from discovery and the parameter names are the
  // specification's rather than ours to remember.
  async function handleLogout() {
    setLoggingOut(true)
    await signOut({ returnTo: "/" })
  }

  const identity = (
    <>
      <SidebarIdentityAvatar>
        <AvatarFallback>{initials}</AvatarFallback>
      </SidebarIdentityAvatar>
      <SidebarIdentityText>
        <SidebarIdentityLabel>{name}</SidebarIdentityLabel>
        <SidebarIdentityDescription>{email}</SidebarIdentityDescription>
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
              aria-label={name}
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
