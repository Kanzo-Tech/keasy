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
import { useRole } from "@/lib/auth/use-role";

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

const HEADING = "Workspace overview";

const storageTile = (configured?: boolean): Tile => ({
  href: "/settings/storage",
  icon: GalleryVerticalEnd,
  title: "Workspace storage",
  value: configured === undefined ? undefined : configured ? "Configured" : "Not set",
  description: "where job outputs land",
  ok: configured,
});

const plural = (n: number | undefined, one: string, many: string) => (n === 1 ? one : many);

const credentialsTile = (n?: number): Tile => ({
  href: "/settings/credentials",
  icon: KeyRound,
  title: "Credentials",
  value: n === undefined ? undefined : String(n),
  description: plural(n, "credential configured", "credentials configured"),
  ok: n === undefined ? undefined : n > 0,
});

const connectionsTile = (n?: number): Tile => ({
  href: "/connections",
  icon: Database,
  title: "Connections",
  value: n === undefined ? undefined : String(n),
  description: plural(n, "connection configured", "connections configured"),
  ok: n === undefined ? undefined : n > 0,
});

const outputsTile = (n?: number): Tile => ({
  href: "/jobs",
  icon: FileText,
  title: "Outputs",
  value: n === undefined ? undefined : String(n),
  description: plural(n, "output published", "outputs published"),
});

/** One dashboard for every role: each tile is drawn for the roles that can read its figure. */
export function Dashboard() {
  const { holds } = useRole();
  return (
    <>
      <SectionRoot className="gap-3" fill={false}>
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>{HEADING}</SectionTitle>
          </SectionTitleGroup>
        </SectionHeader>
        <SectionBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {holds("admin") && (
            <Boundary fallback={<TileView tile={storageTile()} />}>
              <StorageTile />
            </Boundary>
          )}
          {holds("editor") && (
            <Boundary fallback={<TileView tile={credentialsTile()} />}>
              <CredentialsTile />
            </Boundary>
          )}
          <Boundary fallback={<TileView tile={connectionsTile()} />}>
            <ConnectionsTile />
          </Boundary>
          <Boundary fallback={<TileView tile={outputsTile()} />}>
            <OutputsTile />
          </Boundary>
        </SectionBody>
      </SectionRoot>
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

function useConnections() {
  return settled($api.useSuspenseQuery("get", "/v1/connections"));
}

function StorageTile() {
  return <TileView tile={storageTile(useConnections().some((c) => c.target.direction === "sink"))} />;
}

function CredentialsTile() {
  return <TileView tile={credentialsTile(settled($api.useSuspenseQuery("get", "/v1/secrets")).length)} />;
}

function ConnectionsTile() {
  return <TileView tile={connectionsTile(useConnections().length)} />;
}

function OutputsTile() {
  const outputs = useJobs().filter((j) => j.status === "completed" && j.report).length;
  return <TileView tile={outputsTile(outputs)} />;
}

function useJobs() {
  return settled($api.useSuspenseQuery("get", "/v1/jobs", {}, { refetchInterval: pollWhile(hasRunningJobs) }));
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

function TileView({ tile }: { tile: Tile }) {
  return (
    <StatRoot asChild variant={tile.ok === undefined ? "default" : tile.ok ? "success" : "warning"}>
      <Link href={tile.href}>
        <StatIndicator>
          <tile.icon />
        </StatIndicator>
        <StatLabel>{tile.title}</StatLabel>
        <StatValue loading={tile.value === undefined}>{tile.value}</StatValue>
        <StatDescription>{tile.description}</StatDescription>
      </Link>
    </StatRoot>
  );
}
