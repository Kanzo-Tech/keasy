"use client";

import Link from "next/link";
import useSWR from "swr";
import { Cloud, Cable, Building2, FileText, type LucideIcon } from "lucide-react";
import { fetchJobs, fetchCloudAccounts, fetchConnections, fetchOrgSettings } from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { data: jobs } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });
  const { data: accounts } = useSWR("cloud-accounts", fetchCloudAccounts);
  const { data: connections } = useSWR("connections", () => fetchConnections());
  const { data: orgSettings } = useSWR("org-settings", fetchOrgSettings);

  const completedJobs = jobs?.filter((j) => j.status === "completed") ?? [];
  const failedJobs = jobs?.filter((j) => j.status === "failed") ?? [];
  const runningJobs =
    jobs?.filter((j) => j.status === "pending" || j.status === "running") ?? [];

  const accountCount = accounts?.length ?? 0;
  const connectionCount = connections?.length ?? 0;
  const orgConfigured = orgSettings != null && !!orgSettings.publisher_name;
  const catalogCount = completedJobs.filter((j) => j.catalog).length;

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="space-y-8">
        <section>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Dataspace Readiness
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ReadinessCard
              href="/settings?tab=cloud-accounts"
              icon={Cloud}
              title="Cloud Accounts"
              value={String(accountCount)}
              description={
                accountCount === 1 ? "account configured" : "accounts configured"
              }
              ok={accountCount > 0}
            />
            <ReadinessCard
              href="/connections"
              icon={Cable}
              title="Connections"
              value={String(connectionCount)}
              description={
                connectionCount === 1 ? "connection configured" : "connections configured"
              }
              ok={connectionCount > 0}
            />
            <ReadinessCard
              href="/settings?tab=organization"
              icon={Building2}
              title="Organization"
              value={orgConfigured ? "Ready" : "Pending"}
              description={
                orgConfigured ? "Metadata set" : "Required for DCAT generation"
              }
              ok={orgConfigured}
            />
            <ReadinessCard
              href="/jobs"
              icon={FileText}
              title="DCAT Catalogs"
              value={String(catalogCount)}
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
            <StatCard label="Total Jobs" value={jobs?.length ?? 0} />
            <StatCard label="Completed" value={completedJobs.length} />
            <StatCard label="Failed" value={failedJobs.length} />
            <StatCard label="Running" value={runningJobs.length} />
          </div>
        </section>
      </div>
    </div>
  );
}

function ReadinessCard({
  href,
  icon: Icon,
  title,
  value,
  description,
  ok,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  value: React.ReactNode;
  description: string;
  ok?: boolean;
}) {
  return (
    <Link href={href} className="group block h-full">
      <Card className="px-5 py-4 gap-0 rounded-lg shadow-none transition-colors group-hover:border-primary/40 h-full grid grid-rows-[auto_1fr_auto]">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "rounded-full p-1.5 shrink-0",
              ok === true && "bg-green-500/10",
              ok === false && "bg-amber-500/10",
              ok === undefined && "bg-muted",
            )}
          >
            <Icon
              size={14}
              className={cn(
                ok === true && "text-green-500",
                ok === false && "text-amber-500",
                ok === undefined && "text-muted-foreground",
              )}
            />
          </div>
          <span className="text-sm font-medium text-muted-foreground min-w-0 truncate">
            {title}
          </span>
        </div>
        <div className="flex items-end pt-3">
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <p className="text-sm text-muted-foreground pt-1">{description}</p>
      </Card>
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4 gap-0 rounded-lg shadow-none text-center">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </Card>
  );
}
