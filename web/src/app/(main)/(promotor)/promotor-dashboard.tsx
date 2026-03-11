"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, Network } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { SummaryCard } from "@/components/shared/summary-card";

export function PromotorDashboard() {
  const { data: catalogData, isLoading: loading } = useQuery({
    queryKey: queryKeys.admin.orgs,
    queryFn: async () => {
      const data = await api.admin.orgs();
      const participantCount = data.filter(
        (o) => o.role !== "promotor",
      ).length;
      return { participantCount };
    },
  });

  const participantCount = catalogData?.participantCount ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Dataspace Overview
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard
            href="/participants"
            icon={Users}
            title="Participants"
            value={loading ? undefined : String(participantCount)}
            description={
              participantCount === 1 ? "organization" : "organizations"
            }
          />
          <SummaryCard
            href="/graph"
            icon={Network}
            title="Graph"
            value={loading ? undefined : "0"}
            description="data assets published"
          />
        </div>
      </section>
    </div>
  );
}
