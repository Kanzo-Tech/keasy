"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { reverseMapUrl, reverseMapPipeline } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageShell } from "@/components/layout/page-shell";
import {
  OverviewContent,
  CatalogView,
  DiscoveryView,
  ValidationTab,
} from "@/components/jobs/detail";
import { isTerminalStatus } from "@/lib/utils";
import type { JobStatus, JobEvent } from "@/lib/types";

function useJobStream(id: string, status: JobStatus | undefined) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<JobEvent | null>(null);

  useEffect(() => {
    if (!status || isTerminalStatus(status)) return;

    const controller = new AbortController();

    (async () => {
      try {
        for await (const evt of api.jobs.stream(id, controller.signal)) {
          if (controller.signal.aborted) break;
          setProgress(evt);
          if (evt.phase === "complete" || evt.phase === "error") break;
        }
      } catch {
        // abort or network error
      }
      if (!controller.signal.aborted) {
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      }
    })();

    return () => controller.abort();
  }, [id, status, queryClient]);

  return progress;
}

export function JobDetailView({ id }: { id: string }) {
  const {
    data: job,
    isLoading,
  } = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.jobs.get(id),
  });
  const { data: connections } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  const progress = useJobStream(id, job?.status);
  const showSkeleton = useDelayedLoading(isLoading);

  const toastShown = useRef(false);
  useEffect(() => {
    if (job?.status === "failed" && job.error && !toastShown.current) {
      toastShown.current = true;
      toastError(job.error.message);
    }
  }, [job?.status, job?.error]);

  if (isLoading) {
    return showSkeleton ? (
      <div className="flex-1 min-h-0">
        <div className="mx-4 mt-4">
          <Skeleton loading className="inline-flex"><span className="px-3 py-1.5 text-sm">Overview</span></Skeleton>
        </div>
        <div className="p-4 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["ID", "Created", "Run", "Destination"].map((label) => (
              <div key={label} className="space-y-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Skeleton loading className="block"><p className="text-sm font-medium">placeholder</p></Skeleton>
              </div>
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    ) : null;
  }

  if (!job) {
    return <p className="text-muted-foreground">Job not found.</p>;
  }

  const rawPipeline = job.pipeline;
  const pipeline = rawPipeline
    ? reverseMapPipeline(rawPipeline, connections ?? [])
    : rawPipeline;
  const hasPipeline =
    pipeline != null &&
    (pipeline.inputs.length > 0 || pipeline.outputs.length > 0);

  const hasCatalog = !!job.catalog && job.status !== "cancelled";

  const hasDestinations =
    job.status === "completed" &&
    (pipeline?.outputs ?? []).some((o) => o.destination != null);

  const rawDests = [
    ...new Set(
      (rawPipeline?.outputs ?? [])
        .map((o) => o.destination)
        .filter((d): d is string => d != null),
    ),
  ];
  const dests = rawDests.map((d) => reverseMapUrl(d, connections ?? []));

  return (
    <Tabs defaultValue="overview" className="flex-1 min-h-0">
      <TabsList className="mx-4 mt-4">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        {hasCatalog && <TabsTrigger value="catalog">Catalog</TabsTrigger>}
        {job.status === "completed" && (
          <TabsTrigger value="validation">Quality</TabsTrigger>
        )}
        {hasDestinations && (
          <TabsTrigger value="discover">Discovery</TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="overview">
        <PageShell>
          <PageShell.Content>
            <OverviewContent
              job={job}
              dests={dests}
              hasPipeline={hasPipeline}
              progress={progress}
            />
          </PageShell.Content>
        </PageShell>
      </TabsContent>

      <TabsContent value="catalog">
        <PageShell>
          <PageShell.Content>
            <CatalogView id={id} catalog={job.catalog!} />
          </PageShell.Content>
        </PageShell>
      </TabsContent>

      <TabsContent value="validation">
        <ValidationTab jobId={id} />
      </TabsContent>

      {hasDestinations && (
        <TabsContent value="discover">
          <PageShell>
            <PageShell.Content>
              <DiscoveryView jobId={id} />
            </PageShell.Content>
          </PageShell>
        </TabsContent>
      )}
    </Tabs>
  );
}
