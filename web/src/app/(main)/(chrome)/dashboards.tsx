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
import { hasRunningJobs, pollWhile } from "@/lib/jobs";
import { Boundary } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

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

const OWNER_HEADING = "Workspace overview";
const ownerTiles = (value?: string): Tile[] => [
  {
    href: "/catalog",
    icon: GalleryVerticalEnd,
    title: "Catalog Storage",
    value,
    description: "where the catalog is published",
  },
];

export function OwnerDashboard() {
  return (
    <Boundary fallback={<Tiles heading={OWNER_HEADING} tiles={ownerTiles()} />}>
      <OwnerTiles />
    </Boundary>
  );
}

function OwnerTiles() {
  const catalog = settled(
    $api.useSuspenseQuery("get", "/v1/connections"),
  );
  const sink = catalog.find((c) => c.target.direction === "sink");
  return <Tiles heading={OWNER_HEADING} tiles={ownerTiles(sink ? "Configured" : "Not set")} />;
}

const READINESS_HEADING = "Workspace readiness";

/** The three readiness tiles; every figure `undefined` while loading. */
function readinessTiles(figures?: { credentials: number; connections: number; outputs: number }): Tile[] {
  const plural = (n: number | undefined, one: string, many: string) => (n === 1 ? one : many);
  return [
    {
      href: "/settings/credentials",
      icon: KeyRound,
      title: "Credentials",
      value: figures && String(figures.credentials),
      description: plural(figures?.credentials, "credential configured", "credentials configured"),
      ok: figures && figures.credentials > 0,
    },
    {
      href: "/connections",
      icon: Database,
      title: "Connections",
      value: figures && String(figures.connections),
      description: plural(figures?.connections, "connection configured", "connections configured"),
      ok: figures && figures.connections > 0,
    },
    {
      href: "/jobs",
      icon: FileText,
      title: "Outputs",
      value: figures && String(figures.outputs),
      description: plural(figures?.outputs, "output published", "outputs published"),
    },
  ];
}

export function MemberDashboard() {
  return (
    <>
      <Boundary fallback={<Tiles heading={READINESS_HEADING} tiles={readinessTiles()} />}>
        <Readiness />
      </Boundary>
      <SectionRoot className="gap-3" fill={false}>
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>Recent activity</SectionTitle>
          </SectionTitleGroup>
        </SectionHeader>
        <Boundary fallback={<Activity />}>
          <RecentActivity />
        </Boundary>
      </SectionRoot>
    </>
  );
}

function useJobs() {
  return settled($api.useSuspenseQuery("get", "/v1/jobs", {}, { refetchInterval: pollWhile(hasRunningJobs) }));
}

function Readiness() {
  const jobs = useJobs();
  const credentials = settled($api.useSuspenseQuery("get", "/v1/credentials"));
  const connections = settled($api.useSuspenseQuery("get", "/v1/connections"));
  const outputs = jobs.filter((j) => j.status === "completed" && j.report).length;
  return (
    <Tiles
      heading={READINESS_HEADING}
      tiles={readinessTiles({ credentials: credentials.length, connections: connections.length, outputs })}
    />
  );
}

function RecentActivity() {
  const jobs = useJobs();
  const count = (status: Schemas["JobStatus"][]) => jobs.filter((j) => status.includes(j.status)).length;
  return (
    <Activity
      stats={[
        { label: "Total jobs", value: jobs.length },
        { label: "Completed", value: count(["completed"]) },
        { label: "Failed", value: count(["failed"]) },
        { label: "Running", value: count(["pending", "running"]) },
      ]}
    />
  );
}

const ACTIVITY = ["Total jobs", "Completed", "Failed", "Running"];

/** The activity figures; loading when `stats` is absent. */
function Activity({ stats }: { stats?: { label: string; value: number }[] }) {
  return (
    <SectionBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(stats ?? ACTIVITY.map((label) => ({ label, value: 0 }))).map((stat) => (
        <StatRoot key={stat.label}>
          <StatLabel>{stat.label}</StatLabel>
          <StatValue loading={!stats}>
            <FormatNumber value={stat.value} />
          </StatValue>
        </StatRoot>
      ))}
    </SectionBody>
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
