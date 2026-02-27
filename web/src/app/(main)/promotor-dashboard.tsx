"use client";

import useSWR from "swr";
import { Users, BookOpenCheck, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

export function PromotorDashboard() {
  const { data: catalogData, isLoading: loading } = useSWR(
    "promotor-dashboard",
    () =>
      fetch("/api/admin/organizations")
        .then((r) => r.json())
        .then((r) => {
          const data = r.data ?? [];
          const participantCount = data.filter(
            (o: { role: string }) => o.role !== "promotor",
          ).length;
          return { participantCount };
        }),
  );

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
            href="/catalog"
            icon={BookOpenCheck}
            title="Catalog Items"
            value={loading ? undefined : "0"}
            description="data assets published"
          />
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  href,
  icon: Icon,
  title,
  value,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  value: React.ReactNode;
  description: string;
}) {
  return (
    <Link href={href} className="group block h-full">
      <Card className="px-5 py-4 gap-0 rounded-lg shadow-none transition-colors group-hover:border-primary/40 h-full">
        <div className="flex items-center gap-2">
          <div className="rounded-full p-1.5 bg-muted shrink-0">
            <Icon size={14} className="text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">
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
