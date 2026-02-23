"use client";

import { use, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toastError } from "@/lib/toast-error";
import { fetchJob, fetchJobCatalog, cancelJob, fetchConnections } from "@/lib/api";
import { reverseMapUrl, reverseMapPipeline } from "@/lib/formatters";
import { JobStatusBadge } from "@/components/job-status-badge";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewContent, CatalogView, DiscoveryView, ValidationTab } from "@/components/job-detail";
import type { JobStatus } from "@/lib/types";

function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: job, isLoading, mutate } = useSWR(`job-${id}`, () => fetchJob(id), {
    refreshInterval: (data) => (data && isTerminal(data.status) ? 0 : 2000),
  });
  const { data: connections } = useSWR("connections", fetchConnections);

  const [dcatFormat, setDcatFormat] = useState("turtle");

  const catalogSwrKey = job?.catalog && dcatFormat !== "turtle"
    ? `catalog-${id}-${dcatFormat}` : null;
  const { data: fetchedCatalog, isLoading: catalogLoading } = useSWR(
    catalogSwrKey,
    () => fetchJobCatalog(id, dcatFormat),
  );
  const catalogContent = dcatFormat === "turtle" ? (job?.catalog ?? null) : (fetchedCatalog ?? null);

  const toastShown = useRef(false);
  useEffect(() => {
    if (job?.status === "failed" && job.error && !toastShown.current) {
      toastShown.current = true;
      toastError(job.error.message);
    }
  }, [job?.status, job?.error]);

  async function handleCancel() {
    await cancelJob(id);
    mutate();
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
  const hasPipeline = pipeline != null &&
    (pipeline.inputs.length > 0 || pipeline.outputs.length > 0);

  const hasCatalog = !!job.catalog && job.status !== "cancelled";

  const hasDestinations =
    job.status === "completed" &&
    (pipeline?.outputs ?? []).some((o) => o.destination != null);

  const hasTabs = hasCatalog || hasDestinations;

  const rawDests = [...new Set(
    (rawPipeline?.outputs ?? [])
      .map((o) => o.destination)
      .filter((d): d is string => d != null)
  )];
  const dests = rawDests.map((d) => reverseMapUrl(d, connections ?? []));

  return (
    <div className="flex flex-col h-full">
      {hasTabs ? (
        <Tabs defaultValue="overview" className="flex-1 min-h-0 flex flex-col">
          <PageHeader
            title={job.name ?? job.id.slice(0, 8)}
            badge={<JobStatusBadge status={job.status} />}
            backHref="/jobs"
            backLabel="Jobs"
            action={
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                {hasCatalog && <TabsTrigger value="catalog">Catalog</TabsTrigger>}
                {hasDestinations && <TabsTrigger value="validation">Quality</TabsTrigger>}
                {hasDestinations && <TabsTrigger value="discover">Discovery</TabsTrigger>}
              </TabsList>
            }
          />

          <TabsContent value="overview" className="flex flex-col flex-1 min-h-0">
            <OverviewContent
              job={job}
              dests={dests}
              hasPipeline={hasPipeline}
              isTerminal={isTerminal(job.status)}
              onCancel={handleCancel}
            />
          </TabsContent>

          <TabsContent value="catalog" className="flex flex-col min-h-0 flex-1">
            <CatalogView
              id={id}
              catalog={job.catalog!}
              dcatFormat={dcatFormat}
              setDcatFormat={setDcatFormat}
              catalogContent={catalogContent}
              catalogLoading={catalogLoading}
            />
          </TabsContent>

          <TabsContent value="validation" className="overflow-y-auto">
            <ValidationTab
              destinations={rawDests}
            />
          </TabsContent>

          {hasDestinations && (
            <TabsContent value="discover" className="flex flex-col min-h-0">
              <DiscoveryView jobId={id} />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <PageHeader
            title={job.name ?? job.id.slice(0, 8)}
            badge={<JobStatusBadge status={job.status} />}
            backHref="/jobs"
            backLabel="Jobs"
            action={undefined}
          />
          <OverviewContent
            job={job}
            dests={dests}
            hasPipeline={hasPipeline}
            isTerminal={isTerminal(job.status)}
            onCancel={handleCancel}
          />
        </div>
      )}
    </div>
  );
}
