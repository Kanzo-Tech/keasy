"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Paintbrush, Cloud, Sparkles, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

const sections: { heading: string; items: NavItem[] }[] = [
  {
    heading: "General",
    items: [
      { href: "/settings/preferences", label: "Preferences", icon: Paintbrush },
      { href: "/settings/security", label: "Security", icon: Shield },
    ],
  },
  {
    heading: "Integrations",
    items: [
      { href: "/settings/cloud-accounts", label: "Cloud Accounts", icon: Cloud },
      { href: "/settings/ai", label: "AI", icon: Sparkles },
    ],
  },
];

export function SettingsNav() {
  const pathname = usePathname();

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
