"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Paintbrush, Building2, Cloud, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

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
      { href: "/settings/organization", label: "Organization", icon: Building2 },
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
    <nav className="w-48 shrink-0 space-y-6">
      {sections.map((section) => (
        <div key={section.heading}>
          <h4 className="text-xs font-medium text-muted-foreground mb-1 px-2">
            {section.heading}
          </h4>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <item.icon size={15} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
