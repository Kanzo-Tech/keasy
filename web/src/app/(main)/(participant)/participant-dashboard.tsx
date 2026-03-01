"use client";

import Link from "next/link";
import useSWR from "swr";
import {
  Cloud,
  Database,
  ShieldCheck,
  FileText,
  type LucideIcon,
} from "lucide-react";
import {
  fetchJobs,
  fetchCloudAccounts,
  fetchConnections,
  fetchComplianceStatus,
} from "@/lib/api";
import { hasRunningJobs } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ParticipantDashboard() {
  const { data: jobs, isLoading: jobsLoading } = useSWR("jobs", fetchJobs, {
    refreshInterval: (data) => (hasRunningJobs(data) ? 2000 : 0),
  });
  const { data: accounts, isLoading: accountsLoading } = useSWR(
    "cloud-accounts",
    fetchCloudAccounts,
  );
  const { data: connections, isLoading: connectionsLoading } = useSWR(
    "connections",
    () => fetchConnections(),
  );
  const { data: complianceStatus, isLoading: complianceLoading } = useSWR(
    "gx-compliance-status",
    fetchComplianceStatus,
  );

  const loading =
    jobsLoading || accountsLoading || connectionsLoading || complianceLoading;

  const completedJobs = jobs?.filter((j) => j.status === "completed") ?? [];
  const failedJobs = jobs?.filter((j) => j.status === "failed") ?? [];
  const runningJobs =
    jobs?.filter((j) => j.status === "pending" || j.status === "running") ?? [];

  const accountCount = accounts?.length ?? 0;
  const connectionCount = connections?.length ?? 0;
  const isCompliant = complianceStatus?.compliant ?? false;
  const catalogCount = completedJobs.filter((j) => j.catalog).length;

  return (
      <div className="space-y-8">
        <section>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Dataspace Readiness
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ReadinessCard
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
            <ReadinessCard
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
            <ReadinessCard
              href="/organization/details"
              icon={ShieldCheck}
              title="Compliance"
              value={
                loading ? undefined : isCompliant ? "Compliant" : "Pending"
              }
              description={
                isCompliant
                  ? "Gaia-X conformant"
                  : "Complete the compliance wizard"
              }
              ok={loading ? undefined : isCompliant}
            />
            <ReadinessCard
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
          {value === undefined ? (
            <Skeleton className="h-8 w-10" />
          ) : (
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
          )}
        </div>
        <p className="text-sm text-muted-foreground pt-1">{description}</p>
      </Card>
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card className="p-4 gap-0 rounded-lg shadow-none text-center">
      {value === undefined ? (
        <Skeleton className="h-8 w-10 mx-auto" />
      ) : (
        <p className="text-2xl font-semibold">{value}</p>
      )}
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </Card>
  );
}
