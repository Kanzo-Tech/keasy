"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  Database,
  FileText,
} from "lucide-react";
import { api } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCard } from "@/components/shared/summary-card";

export function MemberDashboard() {
  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: api.jobs.list,
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });
  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: queryKeys.cloud.accounts,
    queryFn: api.cloud.list,
  });
  const { data: connections, isLoading: connectionsLoading } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  const loading = jobsLoading || accountsLoading || connectionsLoading;

  const completedJobs = jobs?.filter((j) => j.status === "completed") ?? [];
  const failedJobs = jobs?.filter((j) => j.status === "failed") ?? [];
  const runningJobs =
    jobs?.filter((j) => j.status === "pending" || j.status === "running") ?? [];

  const accountCount = accounts?.length ?? 0;
  const connectionCount = connections?.length ?? 0;
  const catalogCount = completedJobs.filter((j) => j.manifest).length;

  return (
      <div className="space-y-8">
        <section>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Workspace Readiness
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryCard
              href="/settings/cloud-accounts"
              icon={Cloud}
              title="Cloud Accounts"
              value={loading ? undefined : String(accountCount)}
              description={
                accountCount === 1
                  ? "account configured"
                  : "accounts configured"
              }
              ok={loading ? undefined : accountCount > 0}
            />
            <SummaryCard
              href="/connections"
              icon={Database}
              title="Connections"
              value={loading ? undefined : String(connectionCount)}
              description={
                connectionCount === 1
                  ? "connection configured"
                  : "connections configured"
              }
              ok={loading ? undefined : connectionCount > 0}
            />
            <SummaryCard
              href="/jobs"
              icon={FileText}
              title="DCAT Catalogs"
              value={loading ? undefined : String(catalogCount)}
              description={
                catalogCount === 1 ? "catalog generated" : "catalogs generated"
              }
            />
          </div>
        </section>

        <section>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Recent Activity
          </p>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Total Jobs"
              value={loading ? undefined : (jobs?.length ?? 0)}
            />
            <StatCard
              label="Completed"
              value={loading ? undefined : completedJobs.length}
            />
            <StatCard
              label="Failed"
              value={loading ? undefined : failedJobs.length}
            />
            <StatCard
              label="Running"
              value={loading ? undefined : runningJobs.length}
            />
          </div>
        </section>

      </div>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card className="p-4 gap-0 rounded-lg shadow-none text-center">
      <Skeleton loading={value === undefined}>
        <p className="text-2xl font-semibold">{value ?? 0}</p>
      </Skeleton>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </Card>
  );
}
