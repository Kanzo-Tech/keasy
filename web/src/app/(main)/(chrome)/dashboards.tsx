"use client";

import { Database, FileText, GalleryVerticalEnd, KeyRound, type LucideIcon } from "lucide-react";
import {
  FormatNumber,
  SectionBody,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  StatDescription,
  StatIndicator,
  StatLabel,
  StatRoot,
  StatValue,
} from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";
import { $api, type Schemas } from "@/lib/api/client";
import { storageOf } from "@/lib/connections";
import { hasRunningJobs } from "@/lib/jobs";

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
  const catalog = $api.useQuery("get", "/v1/connections", { params: { query: { purpose: "storage" } } });
  const sink = catalog.data?.find((c) => storageOf(c)?.direction === "sink");

  return (
    <Tiles
      heading="Workspace overview"
      tiles={[
        {
          href: "/catalog",
          icon: GalleryVerticalEnd,
          title: "Catalog Storage",
          value: catalog.isLoading ? undefined : sink ? "Configured" : "Not set",
          description: "where the catalog is published",
        },
      ]}
    />
  );
}

export function MemberDashboard() {
  const jobs = $api.useQuery("get", "/v1/jobs", {}, {
    refetchInterval: (query) => (hasRunningJobs(query.state.data) ? 2000 : 0),
  });
  const accounts = $api.useQuery("get", "/v1/credentials");
  const connections = $api.useQuery("get", "/v1/connections");
  const loading = jobs.isLoading || accounts.isLoading || connections.isLoading;

  const all = jobs.data ?? [];
  const count = (status: Schemas["JobStatus"][]) => all.filter((j) => status.includes(j.status)).length;
  const accountCount = accounts.data?.length ?? 0;
  const connectionCount = connections.data?.length ?? 0;
  const outputCount = all.filter((j) => j.status === "completed" && j.manifest).length;

  return (
    <>
      <Tiles
        heading="Workspace readiness"
        tiles={[
          {
            href: "/settings/credentials",
            icon: KeyRound,
            title: "Credentials",
            value: loading ? undefined : String(accountCount),
            description: accountCount === 1 ? "credential configured" : "credentials configured",
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
            title: "Outputs",
            value: loading ? undefined : String(outputCount),
            description: outputCount === 1 ? "output published" : "outputs published",
          },
        ]}
      />

      <SectionRoot className="gap-3" fill={false}>
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>Recent activity</SectionTitle>
          </SectionTitleGroup>
        </SectionHeader>
        <SectionBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total jobs", value: all.length },
            { label: "Completed", value: count(["completed"]) },
            { label: "Failed", value: count(["failed"]) },
            { label: "Running", value: count(["pending", "running"]) },
          ].map((stat) => (
            <StatRoot key={stat.label}>
              <StatLabel>{stat.label}</StatLabel>
              <StatValue loading={loading}>
                <FormatNumber value={stat.value} />
              </StatValue>
            </StatRoot>
          ))}
        </SectionBody>
      </SectionRoot>
    </>
  );
}

function Tiles({ heading, tiles }: { heading: string; tiles: Tile[] }) {
  return (
    <SectionRoot className="gap-3" fill={false}>
      <SectionHeader>
        <SectionTitleGroup>
          <SectionTitle>{heading}</SectionTitle>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <StatRoot
            asChild
            key={tile.href}
            variant={tile.ok === undefined ? "default" : tile.ok ? "success" : "warning"}
          >
            <Link href={tile.href}>
              <StatIndicator>
                <tile.icon />
              </StatIndicator>
              <StatLabel>{tile.title}</StatLabel>
              <StatValue loading={tile.value === undefined}>{tile.value}</StatValue>
              <StatDescription>{tile.description}</StatDescription>
            </Link>
          </StatRoot>
        ))}
      </SectionBody>
    </SectionRoot>
  );
}
