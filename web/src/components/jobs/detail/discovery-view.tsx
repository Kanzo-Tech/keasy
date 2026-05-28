"use client";

import { useRef, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Selection } from "@uwdata/mosaic-core";
import { Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { queryKeys } from "@/lib/query-keys";

import { DiscoveryProvider } from "@/components/discovery/store";
import { useCoordinator } from "@/components/discovery/use-discovery-store";
import { GraphCanvas, DEFAULT_GRAPH_CONFIG, type CosmosGraphHandle } from "@fossil-lang/viewer";
import { useGraphDataRows } from "@/components/discovery/use-graph-data-rows";
import { DiscoverySidebar } from "@/components/discovery/discovery-sidebar";
import { HistogramPanel } from "@/components/discovery/histogram-panel";
import { buildGraphSchema } from "@/lib/graph-schema";
import type { DataManifest } from "@/lib/types";
import type { GraphConfigInterface } from "@cosmos.gl/graph";

// ── URL resolution ───────────────────────────────────────────────────────

async function resolveSignedUrls(jobId: string): Promise<Record<string, string>> {
  const res = await fetch(`/v1/jobs/${jobId}/discover/urls`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Failed to resolve discovery URLs (${res.status})`);
  const { files } = (await res.json()) as { files: Record<string, string> };
  return files;
}

function SetupErrorBanner({ error, isCors }: { error: string; isCors: boolean }) {
  if (!isCors) {
    return (
      <div className="rounded-md border bg-destructive/10 border-destructive/20 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";
  return (
    <div className="rounded-md border bg-destructive/10 border-destructive/20 px-4 py-4 text-sm space-y-3">
      <p className="font-medium text-destructive">Cloud storage requires CORS configuration</p>
      <p className="text-muted-foreground">
        Your storage account needs to allow browser access for data exploration.
        Add the following CORS rule in your cloud storage settings:
      </p>
      <div className="rounded bg-muted px-3 py-2 text-xs font-mono space-y-1">
        <p><span className="text-muted-foreground">Allowed origins:</span> {origin}</p>
        <p><span className="text-muted-foreground">Allowed methods:</span> GET, HEAD, OPTIONS</p>
        <p><span className="text-muted-foreground">Allowed headers:</span> Range</p>
        <p><span className="text-muted-foreground">Exposed headers:</span> Content-Range, Accept-Ranges, Content-Length</p>
      </div>
      <p className="text-xs text-muted-foreground">After configuring CORS, reload this page.</p>
    </div>
  );
}

// ── Entry point ──────────────────────────────────────────────────────────

interface DiscoveryViewProps {
  jobId: string;
  manifest: DataManifest;
}

export function DiscoveryView({ jobId, manifest }: DiscoveryViewProps) {
  const { data: signedUrls, isLoading, error } = useQuery({
    queryKey: [...queryKeys.jobs.detail(jobId), "discover-urls"],
    queryFn: () => resolveSignedUrls(jobId),
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Initializing...</p>
        </div>
      </div>
    );
  }

  if (error || !signedUrls) {
    const isCors = error instanceof Error && "cors" in error;
    return (
      <div className="p-4">
        <SetupErrorBanner error={error instanceof Error ? error.message : "Failed to load"} isCors={isCors} />
      </div>
    );
  }

  return (
    <DiscoveryProvider manifest={manifest} signedUrls={signedUrls}>
      <DiscoveryWorkspace jobId={jobId} manifest={manifest} />
    </DiscoveryProvider>
  );
}

// ── Workspace (canvas + sidebar) ─────────────────────────────────────────

function DiscoveryWorkspace({ jobId, manifest }: { jobId: string; manifest: DataManifest }) {
  const coordinator = useCoordinator();
  const isMobile = useIsMobile();
  const kgSchema = useMemo(() => buildGraphSchema(manifest), [manifest]);
  const graphRef = useRef<CosmosGraphHandle>(null);
  const [selectedVertex, setSelectedVertex] = useState<{ id: string; type: string; label: string } | null>(null);
  const [graphConfig, setGraphConfig] = useState<GraphConfigInterface>(DEFAULT_GRAPH_CONFIG);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(384); // lg:w-96 = 384px
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  // Global crossfilter Selection — shared by graph, histograms, chat, and rules
  const selection = useMemo(() => Selection.crossfilter(), []);
  const graphRows = useGraphDataRows(kgSchema);

  const handleConfigChange = (patch: Partial<GraphConfigInterface>) => {
    setGraphConfig((prev) => ({ ...prev, ...patch }));
    graphRef.current?.graph?.setConfig(patch);
  };

  if (!coordinator) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading data...</p>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <DiscoverySidebar
      jobId={jobId}
      schema={kgSchema}
      selectedVertex={selectedVertex}
      graphConfig={graphConfig}
      onConfigChange={handleConfigChange}
      selection={selection}
    />
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Graph canvas — always 100% */}
      <div className="flex-1 min-h-0">
        {graphRows ? (
          <GraphCanvas
            vertices={graphRows.vertices}
            edges={graphRows.edges}
            graphConfig={graphConfig}
            graphRef={graphRef}
            selection={selection}
            onSelectVertex={setSelectedVertex}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading graph…
          </div>
        )}
      </div>

      {/* Histogram panel — bottom */}
      <HistogramPanel schema={kgSchema} selection={selection} />

      {/* Floating sidebar — overlays the canvas */}
      {isMobile ? (
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="right" className="w-[85vw] sm:w-[400px] p-0 flex flex-col">
            <SheetTitle className="sr-only">Discovery panel</SheetTitle>
            {sidebarContent}
          </SheetContent>
        </Sheet>
      ) : (
        sidebarOpen && (
          <div
            className="absolute top-2 right-2 bottom-2 z-20 rounded-lg border bg-background/95 backdrop-blur-sm shadow-lg flex overflow-hidden"
            style={{ width: sidebarWidth }}
          >
            {/* Resize handle — left edge */}
            <div
              className="w-1.5 shrink-0 cursor-col-resize hover:bg-accent/50 active:bg-accent transition-colors"
              onPointerDown={(e) => {
                e.preventDefault();
                dragRef.current = { startX: e.clientX, startW: sidebarWidth };
                const onMove = (ev: PointerEvent) => {
                  if (!dragRef.current) return;
                  const delta = dragRef.current.startX - ev.clientX;
                  const next = Math.max(280, Math.min(600, dragRef.current.startW + delta));
                  setSidebarWidth(next);
                };
                const onUp = () => {
                  dragRef.current = null;
                  document.removeEventListener("pointermove", onMove);
                  document.removeEventListener("pointerup", onUp);
                };
                document.addEventListener("pointermove", onMove);
                document.addEventListener("pointerup", onUp);
              }}
            />
            <div className="flex-1 flex flex-col min-w-0">
              {sidebarContent}
            </div>
          </div>
        )
      )}

      {/* Sidebar toggle */}
      <Button
        variant="outline"
        size="icon"
        className="absolute top-2 z-30 h-7 w-7 bg-background/80 backdrop-blur-sm"
        style={{ right: sidebarOpen && !isMobile ? sidebarWidth + 16 : 8 }}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
      </Button>
    </div>
  );
}
