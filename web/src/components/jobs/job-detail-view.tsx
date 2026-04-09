"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toastError } from "@/lib/toast-error";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { reverseMapUrl, reverseMapPipeline } from "@/lib/formatters";
import { isTerminalStatus } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Code, Compass, Network } from "lucide-react";
import Link from "next/link";

import {
  OverviewContent,
  CatalogView,
} from "@/components/jobs/detail";

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

  const showSkeleton = useDelayedLoading(isLoading);

  // URL-persisted tab/mode state for deep linking
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab = searchParams.get("tab") ?? "overview";
  const catalogMode = searchParams.get("catalogMode") ?? "graph";

  const setParam = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  const setTab = useCallback((v: string) => setParam("tab", v), [setParam]);
  const setCatalogMode = useCallback((v: string) => setParam("catalogMode", v), [setParam]);

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

  const isCompleted = job.status === "completed";
  const hasCatalog = isCompleted && (!!job.rdf_base || !!job.catalog_manifest);
  const hasManifest = isCompleted && !!job.manifest;

  const rawDests = [
    ...new Set(
      (rawPipeline?.outputs ?? [])
        .map((o) => o.destination)
        .filter((d): d is string => d != null),
    ),
  ];
  const dests = rawDests.map((d) => reverseMapUrl(d, connections ?? []));

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0">
      <div className="flex items-center justify-between px-4 pt-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {hasCatalog && <TabsTrigger value="catalog">Catalog</TabsTrigger>}
        </TabsList>

        <div className="flex items-center gap-2">
          {tab === "catalog" && (
            <ToggleGroup type="single" variant="outline" size="sm" value={catalogMode} onValueChange={(v) => { if (v) setCatalogMode(v); }}>
              <ToggleGroupItem value="graph" className="h-7 px-2"><Network size={14} /></ToggleGroupItem>
              <ToggleGroupItem value="serialized" className="h-7 px-2"><Code size={14} /></ToggleGroupItem>
            </ToggleGroup>
          )}
          {hasManifest && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" asChild>
              <Link href={`/jobs/${id}/discover`}>
                <Compass size={14} />
                Open Discovery
              </Link>
            </Button>
          )}
        </div>
      </div>

      <TabsContent value="overview" className="gap-4 overflow-auto p-4">
        <OverviewContent job={job} dests={dests} hasPipeline={hasPipeline} />
      </TabsContent>

      <TabsContent value="catalog" className="gap-4 overflow-auto p-4">
        <CatalogView
          id={id}
          viewMode={catalogMode}
          catalogManifest={job.catalog_manifest}
          onNavigateToDiscovery={hasManifest ? () => setTab("discover") : undefined}
        />
      </TabsContent>

    </Tabs>
  );
}
