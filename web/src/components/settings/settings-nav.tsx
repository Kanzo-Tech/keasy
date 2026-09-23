"use client";

import { Paintbrush, Cloud, Sparkles, ShieldCheck } from "lucide-react";
import { useSession } from "@kanzo-tech/auth";
import { workspaceRole } from "@/lib/roles";
import { SectionNav, type NavSection } from "@/components/layout/section-nav";

export function SettingsNav() {
  const { session } = useSession();
  const isMember = workspaceRole(session) === "member";

  const sections: NavSection[] = [
    {
      heading: "General",
      items: [
        { href: "/settings/preferences", label: "Preferences", icon: Paintbrush },
        { href: "/settings/security", label: "Security", icon: ShieldCheck },
      ],
    },
    // Cloud accounts + AI are the member data plane's own infrastructure.
    ...(isMember
      ? [
          {
            heading: "Data",
            items: [
              { href: "/settings/cloud-accounts", label: "Cloud Accounts", icon: Cloud },
              { href: "/settings/ai", label: "AI", icon: Sparkles },
            ],
          },
        ]
      : []),
  ];

  return <SectionNav sections={sections} />;
}
