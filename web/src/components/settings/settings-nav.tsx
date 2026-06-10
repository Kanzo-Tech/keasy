"use client";

import { Paintbrush, Cloud, Sparkles, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { MeResponse } from "@/lib/types";
import { SectionNav, type NavSection } from "@/components/layout/section-nav";

export function SettingsNav() {
  const { data: me } = useQuery<MeResponse>({ queryKey: queryKeys.me, queryFn: api.auth.me });
  const isMember = me?.effective_role === "member";

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
