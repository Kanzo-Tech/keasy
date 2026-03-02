"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { MeResponse } from "@/lib/types";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export function OrgNav() {
  const pathname = usePathname();

  const { data: me } = useSWR<MeResponse>("auth-me", api.auth.me);
  const isAdmin = me?.effective_role === "org_admin";

  const sections: { heading: string; items: NavItem[] }[] = [
    {
      heading: "General",
      items: [
        { href: "/organization/details", label: "Details", icon: Building2 },
      ],
    },
    ...(isAdmin
      ? [
          {
            heading: "Members",
            items: [
              { href: "/organization/users", label: "Users", icon: Users },
            ],
          },
        ]
      : []),
  ];

  return (
    <nav className="space-y-2">
      {sections.map((section) => (
        <SidebarGroup key={section.heading}>
          <SidebarGroupLabel>{section.heading}</SidebarGroupLabel>
          <SidebarMenu>
            {section.items.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={isActive}>
                    <Link href={item.href}>
                      <item.icon size={15} />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  );
}
