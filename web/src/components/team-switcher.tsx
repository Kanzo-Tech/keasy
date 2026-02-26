"use client"

import * as React from "react"
import { ChevronsUpDown, GalleryVerticalEnd } from "lucide-react"
import { useRouter } from "next/navigation"
import { useSWRConfig } from "swr"

import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

type DataspaceEntry = {
  id: string;
  name: string;
  role: string;
};

const ROLE_LABEL: Record<string, string> = {
  promotor: "Promotor",
  org_admin: "Admin",
  org_user: "User",
};

export function TeamSwitcher({
  dataspaces,
  activeDataspaceId,
}: {
  dataspaces: DataspaceEntry[];
  activeDataspaceId: string | null;
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const { mutate } = useSWRConfig()

  async function handleSwitch(dataspaceId: string) {
    await fetch("/api/auth/set-dataspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataspace_id: dataspaceId }),
    });
    // Invalidate all SWR caches — data is now scoped to a different dataspace
    await mutate(() => true, undefined, { revalidate: false });
    router.push("/");
  }

  // Single-dataspace (or empty): render non-interactive display
  if (dataspaces.length <= 1) {
    const ds = dataspaces[0];
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{ds?.name ?? "No Dataspace"}</span>
              {ds && (
                <span className="truncate text-xs text-muted-foreground">
                  {ROLE_LABEL[ds.role] ?? ds.role}
                </span>
              )}
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const activeDs = dataspaces.find((ds) => ds.id === activeDataspaceId) ?? dataspaces[0];

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
                <GalleryVerticalEnd className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{activeDs?.name ?? "No Dataspace"}</span>
                {activeDs && (
                  <span className="truncate text-xs text-muted-foreground">
                    {ROLE_LABEL[activeDs.role] ?? activeDs.role}
                  </span>
                )}
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
              Dataspaces
            </DropdownMenuLabel>
            {dataspaces.map((ds) => (
              <DropdownMenuItem
                key={ds.id}
                onClick={() => handleSwitch(ds.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <GalleryVerticalEnd className="size-3.5 shrink-0" />
                </div>
                <span className="flex-1 truncate">{ds.name}</span>
                <Badge variant="outline" className="ml-auto text-xs font-normal">
                  {ROLE_LABEL[ds.role] ?? ds.role}
                </Badge>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
