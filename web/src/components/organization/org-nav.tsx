"use client";

import { Building2, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { MeResponse } from "@/lib/types";
import { SectionNav, type NavSection } from "@/components/layout/section-nav";

export function OrgNav() {
  const { data: me } = useQuery<MeResponse>({ queryKey: queryKeys.me, queryFn: api.auth.me });
  const isOwner = me?.effective_role === "owner";

  const sections: NavSection[] = [
    {
      heading: "General",
      items: [
        { href: "/organization/details", label: "Details", icon: Building2 },
      ],
    },
    ...(isOwner
      ? [
          {
            heading: "People",
            items: [
              { href: "/organization/members", label: "Members", icon: Users },
            ],
          },
        ]
      : []),
  ];

  return <SectionNav sections={sections} />;
}
