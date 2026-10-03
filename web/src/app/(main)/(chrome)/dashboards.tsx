"use client";

import { Database, FileText, GalleryVerticalEnd, KeyRound, type LucideIcon } from "lucide-react";
import {
  Badge,
  EmptyDescription,
  EmptyHeader,
  EmptyRoot,
  EmptyTitle,
  FormatNumber,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
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
import { hasRunningJobs, pollWhile, STATUS } from "@/lib/jobs";
import { formatDate } from "@/lib/ui/format";
import { lower, WORDS } from "@/lib/vocabulary";
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
  title: WORDS.storage,
  value: configured === undefined ? undefined : configured ? "Configured" : "Not set",
  description: `where ${lower(WORDS.graph)} ${lower(WORDS.output)}s land`,
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
  title: `${WORDS.output}s`,
  value: n === undefined ? undefined : String(n),
  description: plural(n, `${lower(WORDS.graph)} completed`, `${lower(WORDS.graphs)} completed`),
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
      <SectionRoot className="gap-3" fill={false}>
        <SectionHeader>
          <SectionTitleGroup>
            <SectionTitle>Recent {lower(WORDS.graphs)}</SectionTitle>
          </SectionTitleGroup>
        </SectionHeader>
        <Boundary fallback={null}>
          <RecentGraphs />
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
        { label: `Total ${lower(WORDS.graphs)}`, value: jobs.length },
        { label: "Completed", value: count(["completed"]) },
        { label: "Failed", value: count(["failed"]) },
        { label: "Running", value: count(["running"]) },
      ]}
    />
  );
}

const ACTIVITY = [`Total ${lower(WORDS.graphs)}`, "Completed", "Failed", "Running"];

const RECENT = 5;

/** The newest graphs, each a way into its page. */
function RecentGraphs() {
  const recent = useJobs().slice(0, RECENT);
  if (recent.length === 0) {
    return (
      <EmptyRoot>
        <EmptyHeader>
          <EmptyTitle>No {lower(WORDS.graphs)} yet</EmptyTitle>
          <EmptyDescription>
            <Link href="/jobs">Go to {WORDS.graphs}</Link>
          </EmptyDescription>
        </EmptyHeader>
      </EmptyRoot>
    );
  }
  return (
    <SectionBody>
      <ItemGroup>
        {recent.map((job) => (
          <Item asChild key={job.id} variant="outline">
            <Link href={`/jobs/${job.id}`}>
              <ItemContent>
                <ItemTitle>{job.name ?? job.id.slice(0, 8)}</ItemTitle>
                <ItemDescription>{formatDate(job.created_at)}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant={STATUS[job.status].variant}>{STATUS[job.status].label}</Badge>
              </ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
    </SectionBody>
  );
}

/** The activity figures; loading when `stats` is absent. */
function Activity({ stats }: { stats?: { label: string; value: number }[] }) {
  return (
    <SectionBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {(stats ?? ACTIVITY.map((label) => ({ label, value: 0 }))).map((stat) => (
        // Every figure is a way into the graphs it counts.
        <StatRoot asChild key={stat.label}>
          <Link href="/jobs">
            <StatLabel>{stat.label}</StatLabel>
            <StatValue loading={!stats}>
              <FormatNumber value={stat.value} />
            </StatValue>
          </Link>
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
