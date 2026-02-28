"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Paintbrush, Cloud, Sparkles, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import useSWR from "swr";
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

export function SettingsNav() {
  const pathname = usePathname();

  const { data: me } = useSWR("auth-me", () =>
    fetch("/v1/auth/me")
      .then((r) => r.json())
      .then((r) => r.data ?? r),
  );
  const isPromotor = me?.effective_role === "promotor";

  const sections: { heading: string; items: NavItem[] }[] = isPromotor
    ? [
        {
          heading: "General",
          items: [
            {
              href: "/settings/preferences",
              label: "Preferences",
              icon: Paintbrush,
            },
          ],
        },
      ]
    : [
        {
          heading: "General",
          items: [
            {
              href: "/settings/preferences",
              label: "Preferences",
              icon: Paintbrush,
            },
            { href: "/settings/wallet", label: "Wallet", icon: Wallet },
          ],
        },
        {
          heading: "Integrations",
          items: [
            {
              href: "/settings/cloud-accounts",
              label: "Cloud Accounts",
              icon: Cloud,
            },
            { href: "/settings/ai", label: "AI", icon: Sparkles },
          ],
        },
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
