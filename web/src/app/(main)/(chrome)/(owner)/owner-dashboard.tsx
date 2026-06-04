"use client";

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { SummaryCard } from "@/components/shared/summary-card";

export function OwnerDashboard() {
  const { data: members, isLoading: loading } = useQuery({
    queryKey: queryKeys.org.users,
    queryFn: api.org.users,
  });

  const memberCount = members?.length ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Workspace Overview
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            href="/organization/members"
            icon={Users}
            title="Members"
            value={loading ? undefined : String(memberCount)}
            description={memberCount === 1 ? "person" : "people"}
          />
        </div>
      </section>

    </div>
  );
}
