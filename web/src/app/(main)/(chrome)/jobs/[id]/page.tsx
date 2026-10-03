"use client";

import { use } from "react";
import { Compass, Square } from "lucide-react";
import {
  Button,
  DataList,
  DataListItem,
  DataListItemLabel,
  DataListItemValue,
  SectionActions,
  SectionBody,
  SectionHeader,
  SectionRoot,
  Skeleton,
} from "@kanzo-tech/ui";
import { Link } from "@kanzo-tech/navigation/next";
import { $api, type Schemas } from "@/lib/api/client";
import { useBrowserJobRunner } from "./_parts/use-browser-job-runner";
import { Provenance } from "@/components/provenance";
import { formatDate, formatJobDuration } from "@/lib/ui/format";
import { isRunning, pollWhile, runProblem } from "@/lib/jobs";
import { ProblemView } from "@/components/problem-view";
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Boundary
      fallback={
        <Loading>
          <SectionRoot>
            <SectionBody scale="page">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-40 w-full" />
            </SectionBody>
          </SectionRoot>
        </Loading>
      }
    >
      <JobView id={id} />
    </Boundary>
  );
}

function JobView({ id }: { id: string }) {
  const job = settled(
    $api.useSuspenseQuery(
      "get",
      "/v1/jobs/{id}",
      { params: { path: { id } } },
      { refetchInterval: pollWhile<Schemas["Job"]>((job) => !!job && isRunning(job.status)) },
    ),
  );

  // A `pending` job runs here, in the browser of whoever may change it; the server never runs the
  // mapping, and a reader opening it only watches.
  const { stop } = useBrowserJobRunner(job.can_modify ? job : undefined);

  const problem = runProblem(job);

  return (
    <SectionRoot>
      {stop && (
        <SectionHeader scale="page">
          <SectionActions>
            <Button onClick={stop} size="sm" variant="outline">
              <Square />
              Stop
            </Button>
          </SectionActions>
        </SectionHeader>
      )}
      {job.status === "completed" && !!job.report && (
        <SectionHeader scale="page">
          <SectionActions>
            <Button asChild size="sm" variant="outline">
              <Link href={`/jobs/${id}/discover`}>
                <Compass />
                Open Discovery
              </Link>
            </Button>
          </SectionActions>
        </SectionHeader>
      )}
      <SectionBody scale="page">
        <DataList className="grid gap-x-12 sm:grid-cols-2 lg:grid-cols-4" orientation="vertical">
          <DataListItem>
            <DataListItemLabel>ID</DataListItemLabel>
            <DataListItemValue className="font-mono">{job.id.slice(0, 12)}</DataListItemValue>
          </DataListItem>
          <DataListItem>
            <DataListItemLabel>Created</DataListItemLabel>
            <DataListItemValue>{formatDate(job.created_at)}</DataListItemValue>
          </DataListItem>
          {job.started_at && (
            <DataListItem>
              <DataListItemLabel>Run</DataListItemLabel>
              <DataListItemValue>
                {new Date(job.started_at).toLocaleTimeString()} (
                {job.completed_at ? formatJobDuration(job) : "running"})
              </DataListItemValue>
            </DataListItem>
          )}
          <DataListItem>
            <DataListItemLabel>Destination</DataListItemLabel>
            <DataListItemValue className="font-mono">
              @{job.sink_connection}
              {job.folder && `/${job.folder}/`}
            </DataListItemValue>
          </DataListItem>
        </DataList>
        <Provenance className="mt-4" of={job} />

        {problem && <ProblemView error={problem} />}
      </SectionBody>
    </SectionRoot>
  );
}

