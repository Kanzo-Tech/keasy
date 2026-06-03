"use client";

import { Paintbrush, Cloud, Sparkles, Database } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { MeResponse } from "@/lib/types";
import { SectionNav, type NavSection } from "@/components/layout/section-nav";

export function SettingsNav() {
  const { data: me } = useQuery<MeResponse>({ queryKey: queryKeys.me, queryFn: api.auth.me });
  const isPromotor = me?.effective_role === "owner";
  const isAdmin = me?.effective_role === "admin";

  const sections: NavSection[] = [
    {
      heading: "General",
      items: [
        { href: "/settings/preferences", label: "Preferences", icon: Paintbrush },
      ],
    },
    ...(isPromotor || isAdmin
      ? [
          {
            heading: "Integrations",
            items: [
              { href: "/settings/cloud-accounts", label: "Cloud Accounts", icon: Cloud },
              { href: "/settings/ai", label: "AI", icon: Sparkles },
            ],
          },
        ]
      : []),
    ...(isPromotor
      ? [
          {
            heading: "Catalog",
            items: [
              { href: "/settings/catalog", label: "Catalog Storage", icon: Database },
            ],
          },
        ]
      : []),
  ];

  return <SectionNav sections={sections} />;
}
