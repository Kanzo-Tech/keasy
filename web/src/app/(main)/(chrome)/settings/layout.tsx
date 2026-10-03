"use client";

import { GalleryVerticalEnd, KeyRound, Paintbrush, ShieldCheck, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  isActivePath,
  ShellAside,
  ShellBody,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";
import { useRole } from "@/lib/auth/use-role";

const GENERAL = [
  { href: "/settings/preferences", label: "Preferences", icon: Paintbrush },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
];

// Cloud accounts and AI keys: an editor's.
const DATA = [{ href: "/settings/credentials", label: "Credentials", icon: KeyRound }];

// Where job outputs land, and who belongs: an admin's.
const WORKSPACE = [
  { href: "/settings/storage", label: "Workspace storage", icon: GalleryVerticalEnd },
  { href: "/settings/members", label: "Members", icon: Users },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { holds } = useRole();
  const groups = [
    { heading: "General", items: GENERAL },
    ...(holds("editor") ? [{ heading: "Data", items: DATA }] : []),
    ...(holds("admin") ? [{ heading: "Workspace", items: WORKSPACE }] : []),
  ];

  return (
    <ShellBody className="h-full w-full overflow-hidden">
      <ShellAside aria-label="Settings" className="w-1/5 min-w-50 max-w-62.5 overflow-auto">
        {groups.map((group) => (
          <nav aria-label={group.heading} key={group.heading}>
            <SidebarGroup>
              <SidebarGroupLabel>{group.heading}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActivePath(pathname, item.href)}>
                      <Link href={item.href}>
                        <item.icon />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </nav>
        ))}
      </ShellAside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </ShellBody>
  );
}
