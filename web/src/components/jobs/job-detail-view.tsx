"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toastError } from "@/lib/toast-error";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { reverseMapUrl, reverseMapPipeline } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  OverviewContent,
  CatalogView,
  DiscoveryView,
  ValidationTab,
} from "@/components/jobs/detail";
import type { JobStatus } from "@/lib/types";

function isTerminal(status: JobStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function JobDetailView({ id }: { id: string }) {
  const queryClient = useQueryClient();

  const {
    data: job,
    isLoading,
  } = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.jobs.get(id),
    refetchInterval: (query) => (query.state.data && isTerminal(query.state.data.status) ? 0 : 2000),
  });
  const { data: connections } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  const [dcatFormat, setDcatFormat] = useState("turtle");

  const catalogEnabled = !!job?.catalog && dcatFormat !== "turtle";
  const { data: fetchedCatalog, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.jobs.catalog(id, dcatFormat),
    queryFn: () => api.jobs.catalog(id, dcatFormat),
    enabled: catalogEnabled,
  });
  const catalogContent =
    dcatFormat === "turtle" ? (job?.catalog ?? null) : (fetchedCatalog ?? null);

  const toastShown = useRef(false);
  useEffect(() => {
    if (job?.status === "failed" && job.error && !toastShown.current) {
      toastShown.current = true;
      toastError(job.error.message);
    }
  }, [job?.status, job?.error]);

  const cancelMutation = useMutation({
    mutationFn: () => api.jobs.cancel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.jobs.detail(id) }),
  });

  function handleCancel() {
    cancelMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
      </div>
    );
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
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        {hasCatalog && <TabsTrigger value="catalog">Catalog</TabsTrigger>}
        {hasDestinations && (
          <TabsTrigger value="validation">Quality</TabsTrigger>
        )}
        {hasDestinations && (
          <TabsTrigger value="discover">Discovery</TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="overview">
        <OverviewContent
          job={job}
          dests={dests}
          hasPipeline={hasPipeline}
          isTerminal={isTerminal(job.status)}
          onCancel={handleCancel}
        />
      </TabsContent>

      <TabsContent value="catalog">
        <CatalogView
          id={id}
          catalog={job.catalog!}
          dcatFormat={dcatFormat}
          setDcatFormat={setDcatFormat}
          catalogContent={catalogContent}
          catalogLoading={catalogLoading}
        />
      </TabsContent>

      <TabsContent value="validation">
        <ValidationTab destinations={rawDests} />
      </TabsContent>

      {hasDestinations && (
        <TabsContent value="discover">
          <DiscoveryView jobId={id} />
        </TabsContent>
      )}
    </Tabs>
  );
}
