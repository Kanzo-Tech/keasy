"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { useBrowserJobRunner } from "@/lib/fossil/use-browser-job-runner";
import { queryKeys } from "@/lib/query-keys";
import { reverseMapUrl } from "@/lib/formatters";
import { isTerminalStatus } from "@/lib/utils";
import { Button, Skeleton } from "@kanzo-tech/ui";
import { Compass } from "lucide-react";
import Link from "next/link";

import { OverviewContent } from "@/components/jobs/detail";

export function JobDetailView({ id }: { id: string }) {
  const {
    data: job,
    isLoading,
  } = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.jobs.get(id),
    refetchInterval: (query) =>
      query.state.data && !isTerminalStatus(query.state.data.status) ? 3000 : false,
  });
  const { data: connections } = useQuery({
    queryKey: queryKeys.connections.all(),
    queryFn: () => api.connections.list(),
  });

  // Browser-driven execution: a `Pending` job runs on DataFusion-WASM here in
  // the client (the server never runs the mapping). No-op for any other status.
  useBrowserJobRunner(job);

  const showSkeleton = useDelayedLoading(isLoading);

  const prevStatusRef = useRef(job?.status);
  useEffect(() => {
    if (prevStatusRef.current !== "failed" && job?.status === "failed" && job.error) {
      toastError(job.error.message);
    }
    prevStatusRef.current = job?.status;
  }, [job?.status, job?.error]);

  if (isLoading) {
    return showSkeleton ? (
      <div className="flex-1 min-h-0">
        <div className="mx-4 mt-4">
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="p-4 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {["ID", "Created", "Run", "Destination"].map((label) => (
              <div key={label} className="space-y-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Skeleton className="h-5 w-28" />
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

  const hasManifest = job.status === "completed" && !!job.manifest;

  // Where the output went: the connection the member picked as the destination.
  // It used to read the run report's `dest`, which made the host a reader of
  // fossil's report to learn a fact it decided itself.
  const sink = connections?.find((c) => c.id === job.sink_connection_id);
  const dests = hasManifest && sink ? [reverseMapUrl(sink.url, connections ?? [])] : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-end px-4 pt-4">
        {hasManifest && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
            <Link href={`/jobs/${id}/discover`}>
              <Compass size={14} />
              Open Discovery
            </Link>
          </Button>
        )}
      </div>

      <div className="gap-4 overflow-auto p-4">
        <OverviewContent job={job} dests={dests} />
      </div>
    </div>
  );
}
