"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { BarChart3, Info, Loader2, MessageCircle, Settings2, ShieldCheck, Terminal } from "lucide-react";
import { queryKeys } from "@/lib/query-keys";
import { WorkspaceLayout, type PanelDef } from "@/components/layout/workspace-layout";
import { DiscoveryProvider } from "@/components/discovery/store";
import { useCorpusSchema } from "@/components/discovery/use-discovery-store";
import { useGraphSchema } from "@/components/discovery/use-graph-schema";
import {
  GraphRootProvider,
  useGraph,
  type GraphApi,
  type LookPatch,
  type Sim,
} from "@kanzo-tech/graph";
import { undrawnEdges, useCorpusSource } from "@/components/discovery/use-corpus-source";
import { ClassLegend } from "@/components/discovery/class-legend";
import { NodeInfo } from "@/components/discovery/node-info";
import { GraphSettings } from "@/components/discovery/graph-settings";
import { DiscoveryAsk } from "@/components/discovery/discovery-ask";
import { DiscoverySql } from "@/components/discovery/discovery-sql";
import { RuleBuilder } from "@/components/discovery/rule-builder";
import { AnalysisPanel } from "@/components/discovery/analysis-panel";
import { FloatingControls } from "@/components/discovery/floating-controls";
import { api } from "@/lib/api";

// ── URL resolution ───────────────────────────────────────────────────────

async function resolveSignedUrls(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/discover/urls`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve discovery URLs (${res.status})`);
  const { files } = (await res.json()) as { files: Record<string, string> };
  return files;
}

async function resolveManifestFiles(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/discover/manifest`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve GraphAr manifest (${res.status})`);
  const { manifest_files } = (await res.json()) as { manifest_files: Record<string, string> };
  return manifest_files;
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

  const { data: manifestFiles, isLoading: manifestLoading, error: manifestError } = useQuery({
    queryKey: [...queryKeys.jobs.detail(id), "discover-manifest"],
    queryFn: () => resolveManifestFiles(id),
    enabled: !!job?.manifest,
  });

  if (jobLoading || urlsLoading || manifestLoading || !job?.manifest || !signedUrls || !manifestFiles) {
    return (
      <div className="flex-1 flex items-center justify-center">
        {error || manifestError ? (
          <p className="text-sm text-destructive">{(error ?? manifestError) instanceof Error ? (error ?? manifestError)!.message : "Failed to load"}</p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  return (
    <DiscoveryProvider signedUrls={signedUrls} manifestFiles={manifestFiles}>
      <DiscoveryWorkspace jobId={id} />
    </DiscoveryProvider>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────

function DiscoveryWorkspace({ jobId }: { jobId: string }) {
  const overview = useCorpusSchema();
  const kgSchema = useGraphSchema();
  const [chosenType, setChosenType] = useState<string | null>(null);
  // Derived, not synced: the first class the corpus names is the one drawn until
  // a reader picks another.
  const vertexType = chosenType ?? kgSchema.types[0]?.name ?? null;

  const [selectedVertex, setSelectedVertex] = useState<{ id: string; type: string; label: string } | null>(null);
  const [look, setLook] = useState<LookPatch>({});
  const [sim, setSim] = useState<Partial<Sim>>({});
  const [simulate, setSimulate] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const selection = useMemo(() => Selection.crossfilter(), []);
  const view = useCorpusSource(vertexType, selection);

  // The click handler needs the answer the canvas is currently drawing, which is
  // a value the api only has after this call.
  const apiRef = useRef<GraphApi | null>(null);
  const onPointClick = useCallback(
    (_vertex: bigint, _graph: unknown, index: number) => {
      const id = apiRef.current?.slice?.subjects?.[index];
      if (!id || !vertexType) return;
      setSelectedVertex({ id, type: vertexType, label: id.split(/[/#]/).pop() || id });
    },
    [vertexType],
  );

  const graph = useGraph({
    source: view?.source ?? null,
    look,
    sim,
    simulate,
    onFailure: setFailure,
    events: { onPointClick, onBackgroundClick: () => setSelectedVertex(null) },
  });
  useEffect(() => {
    apiRef.current = graph;
  });

  const undrawn = undrawnEdges(view?.undrawn, overview);

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
    // Raw SQL over the producer's own dataset — runs in the browser
    // (corpus.executeSql, DuckDB-WASM). Producer-scoped at the signed-URL
    // layer, so it lives in the data-discovery surface, not owner-gated.
    {
      id: "sql",
      icon: Terminal,
      label: "SQL",
      content: <DiscoverySql />,
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
      content: (
        <GraphSettings sim={sim} look={look} onSimChange={setSim} onLookChange={setLook} />
      ),
    },
  ];

  return (
    <WorkspaceLayout
      backHref={`/jobs/${jobId}`}
      backLabel="Back to job"
      panels={panels}
      floatingControls={
        <FloatingControls
          api={graph}
          simulationRunning={simulate}
          onToggleSimulation={() => setSimulate((v) => !v)}
        />
      }
      statusLeft={
        <>
          <span className="tabular-nums">
            {kgSchema.types.reduce((sum, t) => sum + t.entityCount, 0).toLocaleString()} nodes
            {" · "}
            {kgSchema.edges.reduce((sum, e) => sum + e.count, 0).toLocaleString()} edges
          </span>
          {graph.sliced && (
            <>
              <span className="text-border">|</span>
              <span className="tabular-nums">
                drawing {graph.slice?.marks.toLocaleString() ?? 0} of {graph.total?.toLocaleString() ?? "?"}
              </span>
            </>
          )}
          {failure && (
            <>
              <span className="text-border">|</span>
              <span className="text-destructive truncate max-w-60">{failure}</span>
            </>
          )}
          {selectedVertex && (
            <>
              <span className="text-border">|</span>
              <span className="truncate max-w-40">{selectedVertex.label}</span>
            </>
          )}
        </>
      }
    >
      <GraphRootProvider value={graph} className="flex-1">
        <div className="absolute left-2 top-2 z-10 max-w-52">
          <ClassLegend
            types={kgSchema.types}
            value={vertexType}
            onChange={setChosenType}
            undrawn={undrawn}
          />
        </div>
      </GraphRootProvider>
    </WorkspaceLayout>
  );
}
