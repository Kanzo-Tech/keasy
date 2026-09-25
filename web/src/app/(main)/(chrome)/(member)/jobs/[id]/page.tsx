"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, Compass } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { $api } from "@/lib/api/client";
import { storageConnections } from "@/lib/connections";
import { useBrowserJobRunner } from "@/lib/fossil/use-browser-job-runner";
import { formatDate, formatJobDuration } from "@/lib/formatters";
import { isTerminalStatus } from "@/lib/jobs";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: job, isLoading } = $api.useQuery(
    "get",
    "/v1/jobs/{id}",
    { params: { path: { id } } },
    {
      refetchInterval: (query) =>
        query.state.data && !isTerminalStatus(query.state.data.status) ? 3000 : false,
    },
  );
  const { data: connections = [] } = $api.useQuery("get", "/v1/connections");

  // A `pending` job runs here, in the browser; the server never runs the mapping.
  useBrowserJobRunner(job);

  const showSkeleton = useDelayedLoading(isLoading);

  if (isLoading) {
    return showSkeleton ? (
      <SectionRoot>
        <SectionBody scale="page">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
        </SectionBody>
      </SectionRoot>
    ) : null;
  }
  if (!job) notFound();

  const sink = storageConnections(connections).find((c) => c.name === job.sink_connection);

  return (
    <SectionRoot>
      {job.status === "completed" && !!job.manifest && (
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
          {sink && (
            <DataListItem>
              <DataListItemLabel>Destination</DataListItemLabel>
              <DataListItemValue className="font-mono">@{sink.name}</DataListItemValue>
            </DataListItem>
          )}
        </DataList>

        {job.error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>The run failed</AlertTitle>
            <AlertDescription>
              <pre className="whitespace-pre-wrap font-mono text-xs">{job.error}</pre>
            </AlertDescription>
          </Alert>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
