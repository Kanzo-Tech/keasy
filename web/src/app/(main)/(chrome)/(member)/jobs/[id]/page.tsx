"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, Compass } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
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
import { api } from "@/lib/api";
import { getErrorInfo } from "@/lib/error-codes";
import { useBrowserJobRunner } from "@/lib/fossil/use-browser-job-runner";
import { formatDuration } from "@/lib/formatters";
import { queryKeys } from "@/lib/query-keys";
import { isTerminalStatus } from "@/lib/utils";

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: job, isLoading } = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.jobs.get(id),
    refetchInterval: (query) =>
      query.state.data && !isTerminalStatus(query.state.data.status) ? 3000 : false,
  });
  const { data: connections = [] } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

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

  const sink = connections.find((c) => c.id === job.sink_connection_id);
  const error = job.error && getErrorInfo(job.error.code);

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
            <DataListItemValue>{new Date(job.created_at).toLocaleString()}</DataListItemValue>
          </DataListItem>
          {job.started_at && (
            <DataListItem>
              <DataListItemLabel>Run</DataListItemLabel>
              <DataListItemValue>
                {new Date(job.started_at).toLocaleTimeString()} (
                {job.completed_at ? formatDuration(job.started_at, job.completed_at) : "running"})
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

        {job.error && error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>{error.message}</AlertTitle>
            <AlertDescription>
              {error.link && (
                <Button asChild className="w-fit" size="sm" variant="outline">
                  <Link href={error.link.href}>{error.link.label}</Link>
                </Button>
              )}
              {job.error.detail && (
                <Collapsible>
                  <CollapsibleTrigger className="text-xs underline underline-offset-2">
                    Technical details
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{job.error.detail}</pre>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </AlertDescription>
          </Alert>
        )}
      </SectionBody>
    </SectionRoot>
  );
}
