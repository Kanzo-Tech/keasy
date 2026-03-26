"use client";

import { use, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { BarChart3, Info, Loader2, MessageCircle, Settings2, ShieldCheck } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { buildGraphSchema } from "@/lib/graph-schema";
import { WorkspaceLayout, type PanelDef } from "@/components/layout/workspace-layout";
import { DiscoveryProvider } from "@/components/discovery/store";
import { useCoordinator } from "@/components/discovery/use-discovery-store";
import { GraphCanvas, DEFAULT_GRAPH_CONFIG } from "@/components/discovery/graph-view-v2";
import { NodeInfo } from "@/components/discovery/node-info";
import { GraphSettings } from "@/components/discovery/graph-settings";
import { DiscoveryAsk } from "@/components/discovery/discovery-ask";
import { RuleBuilder } from "@/components/discovery/rule-builder";
import { AnalysisPanel } from "@/components/discovery/analysis-panel";
import { FloatingControls } from "@/components/discovery/floating-controls";
import type { CosmosGraphHandle } from "@/components/discovery/cosmos-graph";
import type { GraphConfigInterface } from "@cosmos.gl/graph";
import type { DataManifest } from "@/lib/types";
import { api } from "@/lib/api";

// ── URL resolution ───────────────────────────────────────────────────────

async function resolveSignedUrls(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/discover/urls`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve discovery URLs (${res.status})`);
  const { files } = (await res.json()) as { files: Record<string, string> };
  return files;
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: () => api.jobs.get(id),
  });

  const { data: signedUrls, isLoading: urlsLoading, error } = useQuery({
    queryKey: [...queryKeys.jobs.detail(id), "discover-urls"],
    queryFn: () => resolveSignedUrls(id),
    enabled: !!job?.manifest,
  });

  if (jobLoading || urlsLoading || !job?.manifest || !signedUrls) {
    return (
      <div className="flex-1 flex items-center justify-center">
        {error ? (
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load"}</p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <DiscoveryProvider manifest={job.manifest} signedUrls={signedUrls}>
      <DiscoveryWorkspace jobId={id} manifest={job.manifest} />
    </DiscoveryProvider>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────

function DiscoveryWorkspace({ jobId, manifest }: { jobId: string; manifest: DataManifest }) {
  const coordinator = useCoordinator();
  const kgSchema = useMemo(() => buildGraphSchema(manifest), [manifest]);
  const graphRef = useRef<CosmosGraphHandle>(null);
  const [selectedVertex, setSelectedVertex] = useState<{ id: string; type: string; label: string } | null>(null);
  const [graphConfig, setGraphConfig] = useState<GraphConfigInterface>(DEFAULT_GRAPH_CONFIG);
  const [simulationRunning, setSimulationRunning] = useState(true);
  const selection = useMemo(() => Selection.crossfilter(), []);

  const handleConfigChange = useCallback((patch: Partial<GraphConfigInterface>) => {
    setGraphConfig((prev) => ({ ...prev, ...patch }));
    graphRef.current?.graph?.setConfig(patch);
  }, []);

  if (!coordinator) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const panels: PanelDef[] = [
    {
      id: "info",
      icon: Info,
      label: "Info",
      content: <NodeInfo schema={kgSchema} selectedVertex={selectedVertex} />,
    },
    {
      id: "ask",
      icon: MessageCircle,
      label: "Ask AI",
      content: <DiscoveryAsk jobId={jobId} schema="" graphSchema={kgSchema} />,
    },
    {
      id: "rules",
      icon: ShieldCheck,
      label: "Rules",
      content: <RuleBuilder jobId={jobId} schema={kgSchema} />,
    },
    {
      id: "analysis",
      icon: BarChart3,
      label: "Analysis",
      content: <AnalysisPanel schema={kgSchema} selection={selection} />,
    },
    {
      id: "settings",
      icon: Settings2,
      label: "Settings",
      content: <GraphSettings graphConfig={graphConfig} onConfigChange={handleConfigChange} />,
    },
  ];

  return (
    <WorkspaceLayout
      backHref={`/jobs/${jobId}`}
      backLabel="Back to job"
      panels={panels}
      floatingControls={<FloatingControls graphRef={graphRef} simulationRunning={simulationRunning} />}
      statusLeft={
        <>
          <span className="tabular-nums">
            {kgSchema.types.reduce((sum, t) => sum + t.entityCount, 0).toLocaleString()} nodes
            {" · "}
            {kgSchema.edges.reduce((sum, e) => sum + e.count, 0).toLocaleString()} edges
          </span>
          {selectedVertex && (
            <>
              <span className="text-border">|</span>
              <span className="truncate max-w-40">{selectedVertex.label}</span>
            </>
          )}
        </>
      }
    >
      <GraphCanvas
        schema={kgSchema}
        graphConfig={graphConfig}
        graphRef={graphRef}
        selection={selection}
        onSelectVertex={setSelectedVertex}
      />
    </WorkspaceLayout>
  );
}
