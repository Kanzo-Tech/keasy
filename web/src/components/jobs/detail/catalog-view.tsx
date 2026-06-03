"use client";

import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { queryKeys } from "@/lib/query-keys";
import { Database, Loader2 } from "lucide-react";
import { GraphCanvas, DEFAULT_GRAPH_CONFIG, type CosmosGraphHandle } from "@fossil-lang/viewer";
import { useGraphDataRows } from "@/components/discovery/use-graph-data-rows";
import { useGraphSchema } from "@/components/discovery/use-graph-schema";
import { DiscoveryProvider } from "@/components/discovery/store";
import { EmptyState } from "@/components/shared/empty-state";
import type { RunStatus } from "@/lib/types";

interface CatalogViewProps {
  id: string;
  catalogManifest?: RunStatus | null;
}

async function resolveCatalogUrls(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/catalog/urls`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve catalog URLs (${res.status})`);
  const { files } = (await res.json()) as { files: Record<string, string> };
  return files;
}

export function CatalogView({ id, catalogManifest }: CatalogViewProps) {
  // Resolve signed URLs for catalog parquets (DuckDB-WASM reads them directly —
  // the catalog graph is the single source of truth; serialised RDF export, if
  // ever needed, belongs in the GraphAr layer, not the host).
  const { data: signedUrls, isLoading: urlsLoading } = useQuery({
    queryKey: [...queryKeys.jobs.detail(id), "catalog-urls"],
    queryFn: () => resolveCatalogUrls(id),
    enabled: !!catalogManifest,
  });

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
        <CatalogGraphContent manifest={catalogManifest} />
      </DiscoveryProvider>
    </div>
  );
}

function CatalogGraphContent({ manifest }: { manifest: RunStatus }) {
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
