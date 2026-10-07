"use client";

import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyDescription,
  EmptyHeader,
  EmptyRoot,
  EmptyTitle,
  FormatNumber,
  SectionActions,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  StatDescription,
  StatLabel,
  StatRoot,
  StatValue,
  Steps,
  StepsDescription,
  StepsIndicator,
  StepsItem,
  StepsList,
  StepsSeparator,
  StepsTitle,
  StepsTrigger,
} from "@kanzo-tech/ui";
import { DataTableContent, DataTableRoot, useDataTable } from "@kanzo-tech/ui/table";
import { Link, useRouter } from "@kanzo-tech/navigation/next";
import { useSession } from "@kanzo-tech/auth";
import { $api, type Schemas } from "@/lib/api/client";
import { droppedRows, hasRunningGraphs, pollWhile } from "@/lib/graphs";
import { lower, WORDS } from "@/lib/vocabulary";
import { settled } from "@/lib/api/settled";
import { Boundary, Loading } from "@/components/boundary";
import { GRAPH_COLUMNS } from "@/components/graph-columns";

type Graph = Schemas["Graph"];

/** A figure on the overview: `value` is `undefined` while loading. */
interface Figure {
  label: string;
  value?: number;
  description: string;
  href: string;
  /** Something to look at: a figure with no good or bad reading leaves it unset. */
  warn?: boolean;
}

const FIGURES = [WORDS.graphs, "Sources", "Dropped rows"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The newest graphs the dashboard lists; the rest are a click away on the Graphs page. */
const RECENT = 5;

/**
 * The workspace at a glance, after the App shell showcase: the overview's figures, the newest graphs
 * with a way to make another beside their title, and — for an editor — what is left to set up.
 */
export function Dashboard() {
  const editor = useSession().can("editor");
  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Overview
          </SectionTitle>
          <SectionDescription>What this workspace has built from its sources.</SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody className="gap-6" scale="page">
        <Boundary fallback={<Figures />}>
          <Overview />
        </Boundary>
        <div className="grid min-w-0 gap-6 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SectionRoot className="min-w-0 gap-3" fill={false}>
            <SectionHeader>
              <SectionTitleGroup>
                <SectionTitle>{WORDS.graphs}</SectionTitle>
              </SectionTitleGroup>
              <SectionActions>
                <Button asChild size="sm" variant="outline">
                  <Link href="/graphs">View all</Link>
                </Button>
                {editor && (
                  <Button asChild size="sm">
                    <Link href="/graphs/new">
                      <Plus />
                      New {lower(WORDS.graph)}
                    </Link>
                  </Button>
                )}
              </SectionActions>
            </SectionHeader>
            <Boundary
              fallback={
                <Loading>
                  <Skeleton className="h-40 w-full" />
                </Loading>
              }
            >
              <RecentGraphs />
            </Boundary>
          </SectionRoot>
          {editor && (
            <Boundary
              fallback={
                <Loading>
                  <Skeleton className="h-full min-h-64 w-full" />
                </Loading>
              }
            >
              <Setup />
            </Boundary>
          )}
        </div>
      </SectionBody>
    </SectionRoot>
  );
}

function useGraphs() {
  return settled($api.useSuspenseQuery("get", "/v1/graphs", {}, { refetchInterval: pollWhile(hasRunningGraphs) }));
}

function useConnections() {
  return settled($api.useSuspenseQuery("get", "/v1/connections"));
}

/** The figures, as the graphs and connections say them. */
function Overview() {
  const graphs = useGraphs();
  const connections = useConnections();
  const sources = connections.filter((c) => c.target.direction === "source");
  const outputs = connections.length - sources.length;
  const credentials = new Set(sources.map((c) => c.secret)).size;
  const dropping = graphs.flatMap((graph) => {
    const rows = droppedRows(graph);
    return rows ? [{ graph, rows }] : [];
  });
  const dropped = dropping.reduce((sum, d) => sum + d.rows, 0);
  const only = dropping.length === 1 ? dropping[0].graph : undefined;
  return (
    <Figures
      figures={[
        {
          label: WORDS.graphs,
          value: graphs.length,
          description: `${graphs.filter((g) => g.status === "completed").length} completed`,
          href: "/graphs",
        },
        {
          label: "Sources",
          value: sources.length,
          description: `through ${plural(credentials, "credential")} · ${plural(outputs, lower(WORDS.output))}`,
          href: "/connections",
        },
        {
          label: "Dropped rows",
          value: dropped,
          description: only
            ? `In ${name(only)}`
            : dropping.length > 0
              ? `Across ${plural(dropping.length, lower(WORDS.graph))}`
              : "None left out by a join",
          href: only ? `/graphs/${only.id}` : "/graphs",
          warn: dropped > 0,
        },
      ]}
    />
  );
}

/** The overview's row of figures; loading when `figures` is absent. Each is a way into what it counts. */
function Figures({ figures }: { figures?: Figure[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(figures ?? FIGURES.map((label) => ({ label, description: "", href: "/graphs" }) as Figure)).map((f) => (
        <StatRoot asChild key={f.label} variant={f.warn ? "warning" : "default"}>
          <Link href={f.href}>
            <StatLabel>{f.label}</StatLabel>
            <StatValue loading={f.value === undefined}>
              <FormatNumber notation="compact" value={f.value ?? 0} />
            </StatValue>
            <StatDescription>{f.description}</StatDescription>
          </Link>
        </StatRoot>
      ))}
    </div>
  );
}

const name = (graph: Graph) => graph.name ?? graph.id.slice(0, 8);

/** The newest graphs, as the Graphs page lists them: a row is the way into its graph. */
function RecentGraphs() {
  const router = useRouter();
  const recent = useGraphs().slice(0, RECENT);
  const table = useDataTable({ columns: GRAPH_COLUMNS, data: recent });
  if (recent.length === 0) {
    return (
      <EmptyRoot className="border">
        <EmptyHeader>
          <EmptyTitle asChild>
            <h3>No {lower(WORDS.graphs)} yet</h3>
          </EmptyTitle>
          <EmptyDescription>
            A {lower(WORDS.graph)} is a {lower(WORDS.recipe)} over your connections.
          </EmptyDescription>
        </EmptyHeader>
      </EmptyRoot>
    );
  }
  return (
    <DataTableRoot table={table}>
      <DataTableContent<Graph> onRowClick={(graph) => router.push(`/graphs/${graph.id}`)} />
    </DataTableRoot>
  );
}

/** What is left before the workspace has shown what it holds, in the order it is done in. */
function Setup() {
  const secrets = settled($api.useSuspenseQuery("get", "/v1/secrets"));
  const connections = useConnections();
  const graphs = useGraphs();
  const sources = connections.filter((c) => c.target.direction === "source");
  const outputs = connections.length - sources.length;
  const built = graphs.find((g) => g.status === "completed");
  const steps = [
    {
      title: "Add a credential",
      done: secrets.length > 0,
      description: secrets[0]?.name ?? "Who keasy is when it reaches a store",
      href: "/settings/credentials/new",
    },
    {
      title: "Connect a source",
      done: sources.length > 0,
      description:
        sources.length > 0
          ? `${plural(sources.length, "source")}, ${plural(outputs, lower(WORDS.output))}`
          : "A storage prefix to read from",
      href: "/connections/new",
    },
    {
      title: `Build a ${lower(WORDS.graph)}`,
      done: built !== undefined,
      description: built ? name(built) : `A ${lower(WORDS.recipe)} over your sources, run once`,
      href: "/graphs/new",
    },
    {
      title: `${WORDS.explore} it`,
      done: false,
      description: built ? `Open ${name(built)}` : `Once a ${lower(WORDS.graph)} has completed`,
      href: built ? `/graphs/${built.id}/discover` : "/graphs",
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Finish setting up</CardTitle>
        <CardAction>
          <Badge size="sm" variant="secondary">
            {current}/{steps.length}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Steps count={steps.length} orientation="vertical" step={current}>
          <StepsList>
            {steps.map((step, index) => (
              <StepsItem className="[&:not(:last-child)]:min-h-16" index={index} key={step.title}>
                <StepsTrigger asChild>
                  <Link href={step.href}>
                    <StepsIndicator>{index + 1}</StepsIndicator>
                    <span className="flex flex-col items-start gap-0.5">
                      <StepsTitle>{step.title}</StepsTitle>
                      <StepsDescription>{step.description}</StepsDescription>
                    </span>
                  </Link>
                </StepsTrigger>
                <StepsSeparator />
              </StepsItem>
            ))}
          </StepsList>
        </Steps>
      </CardContent>
    </Card>
  );
}
