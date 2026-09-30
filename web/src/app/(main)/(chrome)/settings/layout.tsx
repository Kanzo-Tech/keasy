"use client";

import { KeyRound, Paintbrush, ShieldCheck } from "lucide-react";
import { useSession } from "@kanzo-tech/auth";
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
import { workspaceRole } from "@/lib/auth/roles";

const GENERAL = [
  { href: "/settings/preferences", label: "Preferences", icon: Paintbrush },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
];

// Storage and AI credentials are the member's own data-plane infrastructure.
const DATA = [{ href: "/settings/credentials", label: "Credentials", icon: KeyRound }];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();
  const groups = [
    { heading: "General", items: GENERAL },
    ...(workspaceRole(session) === "member" ? [{ heading: "Data", items: DATA }] : []),
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
