"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, Cloud, Database, FileText, GalleryVerticalEnd, type LucideIcon } from "lucide-react";
import {
  Card,
  SectionHeader,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  StatTile,
} from "@kanzo-tech/ui";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { hasRunningJobs } from "@/lib/utils";

interface Tile {
  href: string;
  icon: LucideIcon;
  title: string;
  /** `undefined` while loading. */
  value?: string;
  description: string;
  /** Unset when the figure has no good or bad reading. */
  ok?: boolean;
}

export function OwnerDashboard() {
  const identity = useQuery({ queryKey: queryKeys.org.identity, queryFn: api.org.identity });
  const catalog = useQuery({
    queryKey: queryKeys.settings.catalogStorage,
    queryFn: api.settings.catalogStorage,
  });

  return (
    <Tiles
      heading="Workspace overview"
      tiles={[
        {
          href: "/identity",
          icon: Building2,
          title: "Identity",
          value: identity.isLoading ? undefined : identity.data?.legal_name?.trim() || "Not set",
          description: "DCAT publisher",
        },
        {
          href: "/catalog",
          icon: GalleryVerticalEnd,
          title: "Catalog Storage",
          value: catalog.isLoading ? undefined : catalog.data ? "Configured" : "Not set",
          description: "where the catalog is published",
        },
      ]}
    />
  );
}

export function MemberDashboard() {
  const jobs = useQuery({
    queryKey: queryKeys.jobs.all,
    queryFn: api.jobs.list,
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });
  const accounts = useQuery({ queryKey: queryKeys.cloud.accounts, queryFn: api.cloud.list });
  const connections = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });
  const loading = jobs.isLoading || accounts.isLoading || connections.isLoading;

  const all = jobs.data ?? [];
  const count = (status: string[]) => all.filter((j) => status.includes(j.status)).length;
  const accountCount = accounts.data?.length ?? 0;
  const connectionCount = connections.data?.length ?? 0;
  const catalogCount = all.filter((j) => j.status === "completed" && j.manifest).length;

  return (
    <>
      <Tiles
        heading="Workspace readiness"
        tiles={[
          {
            href: "/settings/cloud-accounts",
            icon: Cloud,
            title: "Cloud Accounts",
            value: loading ? undefined : String(accountCount),
            description: accountCount === 1 ? "account configured" : "accounts configured",
            ok: loading ? undefined : accountCount > 0,
          },
          {
            href: "/connections",
            icon: Database,
            title: "Connections",
            value: loading ? undefined : String(connectionCount),
            description: connectionCount === 1 ? "connection configured" : "connections configured",
            ok: loading ? undefined : connectionCount > 0,
          },
          {
            href: "/jobs",
            icon: FileText,
            title: "DCAT Catalogs",
            value: loading ? undefined : String(catalogCount),
            description: catalogCount === 1 ? "catalog generated" : "catalogs generated",
          },
        ]}
      />

      <section className="space-y-3">
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>Recent activity</SectionTitle>
          </SectionTitleGroup>
        </SectionHeader>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total jobs", value: all.length },
            { label: "Completed", value: count(["completed"]) },
            { label: "Failed", value: count(["failed"]) },
            { label: "Running", value: count(["pending", "running"]) },
          ].map((stat) =>
            loading ? (
              <Skeleton className="h-24" key={stat.label} />
            ) : (
              <StatTile key={stat.label} label={stat.label} value={stat.value} />
            ),
          )}
        </div>
      </section>
    </>
  );
}

// The kanzo-ui `metric-card` showcase's arrangement: a Card that is the link, its status
// tinting the icon disc.
function Tiles({ heading, tiles }: { heading: string; tiles: Tile[] }) {
  return (
    <section className="space-y-3">
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>{heading}</SectionTitle>
        </SectionTitleGroup>
      </SectionHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Card
            asChild
            className="group/tile flex h-full min-h-32 flex-col gap-0 rounded-lg px-5 py-4 shadow-none transition-colors hover:border-primary/40"
            data-status={tile.ok === undefined ? "neutral" : tile.ok ? "ok" : "warn"}
            key={tile.href}
          >
            <Link href={tile.href}>
              <div className="flex min-w-0 items-center gap-2">
                <div className="shrink-0 rounded-full bg-muted p-1.5 text-muted-foreground group-data-[status=ok]/tile:bg-success/10 group-data-[status=warn]/tile:bg-warning/10 group-data-[status=ok]/tile:text-success group-data-[status=warn]/tile:text-warning [&_svg]:size-3.5">
                  <tile.icon />
                </div>
                <span className="truncate font-medium text-muted-foreground text-sm">{tile.title}</span>
              </div>
              <div className="flex flex-1 items-end pt-3">
                {tile.value === undefined ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="font-semibold text-2xl tracking-tight">{tile.value}</p>
                )}
              </div>
              <p className="pt-1 text-muted-foreground text-sm">{tile.description}</p>
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}
