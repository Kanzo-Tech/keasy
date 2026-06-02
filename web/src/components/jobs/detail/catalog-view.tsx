"use client";

import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { runStatusFromDataManifest } from "@/lib/graph-schema";
import { Database, Loader2 } from "lucide-react";
import { CodeView } from "@/components/discovery/code-view";
import { GraphCanvas, DEFAULT_GRAPH_CONFIG, type CosmosGraphHandle } from "@fossil-lang/viewer";
import { useGraphDataRows } from "@/components/discovery/use-graph-data-rows";
import { useGraphSchema } from "@/components/discovery/use-graph-schema";
import { DiscoveryProvider } from "@/components/discovery/store";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { DataManifest, RunStatus } from "@/lib/types";

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

  // Adapt the RDF-rich catalog DataManifest to a RunStatus so the graph code
  // (mount + schema) consumes one shape. Memoised: the schema hook keys on it.
  const manifest = useMemo(
    () => (catalogManifest ? runStatusFromDataManifest(catalogManifest) : null),
    [catalogManifest],
  );

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

  if (!catalogManifest || !manifest) {
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
      <DiscoveryProvider manifest={manifest} signedUrls={signedUrls}>
        <CatalogGraphContent manifest={manifest} onNavigateToDiscovery={onNavigateToDiscovery} />
      </DiscoveryProvider>
    </div>
  );
}

function CatalogGraphContent({ manifest, onNavigateToDiscovery }: { manifest: RunStatus; onNavigateToDiscovery?: (typeName: string) => void }) {
  const schema = useGraphSchema(manifest);
  const graphRef = useRef<CosmosGraphHandle>(null);
  const selection = useMemo(() => Selection.crossfilter(), []);
  const graphRows = useGraphDataRows(schema);

  if (!graphRows) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading graph…
      </div>
    );
  }

  return (
    <GraphCanvas
      vertices={graphRows.vertices}
      edges={graphRows.edges}
      graphConfig={DEFAULT_GRAPH_CONFIG}
      graphRef={graphRef}
      selection={selection}
      onSelectVertex={() => {}}
    />
  );
}
