"use client";

import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { buildGraphSchema } from "@/lib/graph-schema";
import { Database, Loader2 } from "lucide-react";
import { CodeView } from "@/components/discovery/code-view";
import { GraphCanvas, DEFAULT_GRAPH_CONFIG } from "@/components/discovery/graph-view-v2";
import { DiscoveryProvider } from "@/components/discovery/store";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { CosmosGraphHandle } from "@/components/discovery/cosmos-graph";
import type { DataManifest } from "@/lib/types";

export type DcatFormat = "turtle" | "jsonld" | "rdfxml" | "ntriples" | "nquads";

interface CatalogViewProps {
  id: string;
  viewMode?: string;
  catalogManifest?: DataManifest | null;
  onNavigateToDiscovery?: (typeName: string) => void;
}

async function resolveCatalogUrls(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/catalog/urls`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve catalog URLs (${res.status})`);
  const { files } = (await res.json()) as { files: Record<string, string> };
  return files;
}

export function CatalogView({ id, viewMode = "graph", catalogManifest, onNavigateToDiscovery }: CatalogViewProps) {
  // Serialized view: fetch Turtle from server (download endpoint)
  const { data: fetchedCatalog, isLoading: catalogLoading } = useQuery({
    queryKey: queryKeys.jobs.catalog(id, "turtle"),
    queryFn: () => api.jobs.catalog(id),
    enabled: viewMode === "serialized",
  });
  const showCatalogSkeleton = useDelayedLoading(catalogLoading);

  // Resolve signed URLs for catalog parquets
  const { data: signedUrls, isLoading: urlsLoading } = useQuery({
    queryKey: [...queryKeys.jobs.detail(id), "catalog-urls"],
    queryFn: () => resolveCatalogUrls(id),
    enabled: viewMode === "graph" && !!catalogManifest,
  });

  if (viewMode === "serialized") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {catalogLoading ? (
          showCatalogSkeleton ? (
            <div className="space-y-2 p-3">
              <Skeleton loading className="block w-full"><p className="text-sm font-mono">@prefix dcat: placeholder .</p></Skeleton>
              <Skeleton loading className="block w-3/4"><p className="text-sm font-mono">@prefix dct: placeholder .</p></Skeleton>
              <Skeleton loading className="block w-5/6"><p className="text-sm font-mono">@prefix xsd: placeholder .</p></Skeleton>
            </div>
          ) : null
        ) : (
          <CodeView code={fetchedCatalog ?? ""} lang="turtle" />
        )}
      </div>
    );
  }

  if (!catalogManifest) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Database}
          title="No catalog data"
          description="No catalog data available for this job."
        />
      </div>
    );
  }

  if (urlsLoading || !signedUrls) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DiscoveryProvider manifest={catalogManifest} signedUrls={signedUrls}>
        <CatalogGraphContent catalogManifest={catalogManifest} onNavigateToDiscovery={onNavigateToDiscovery} />
      </DiscoveryProvider>
    </div>
  );
}

function CatalogGraphContent({ catalogManifest, onNavigateToDiscovery }: { catalogManifest: DataManifest; onNavigateToDiscovery?: (typeName: string) => void }) {
  const schema = useMemo(() => buildGraphSchema(catalogManifest), [catalogManifest]);
  const graphRef = useRef<CosmosGraphHandle>(null);
  const selection = useMemo(() => Selection.crossfilter(), []);

  return (
    <GraphCanvas
      schema={schema}
      graphConfig={DEFAULT_GRAPH_CONFIG}
      graphRef={graphRef}
      selection={selection}
      onSelectVertex={() => {}}
    />
  );
}
