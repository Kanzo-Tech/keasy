"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Info,
  Maximize,
  MessageCircle,
  Minus,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { GraphRootProvider, useGraph, type GraphApi } from "@kanzo-tech/graph";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  ShellBody,
  ShellFooter,
  ShellMain,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { DiscoveryAsk } from "@/components/discovery/discovery-ask";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AnalysisPanel } from "./_parts/analysis-panel";
import { ClassLegend } from "./_parts/class-legend";
import { CorpusProvider, corpusQuery, useCorpus, useGraphSchema } from "./_parts/corpus";
import { undrawnEdges, useCorpusSource } from "./_parts/corpus-source";
import { useGraphPrefs } from "./_parts/graph-prefs";
import { NodeInfo, type SelectedVertex } from "./_parts/node-info";
import { RulesPanel } from "./_parts/rules-panel";
import { SqlPanel } from "./_parts/sql-panel";

export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useQuery({ queryKey: queryKeys.jobs.detail(id), queryFn: () => api.jobs.get(id) });
  const corpus = useQuery({ ...corpusQuery(id), enabled: Boolean(job.data?.manifest) });

  if (corpus.error) {
    return (
      <ShellMain className="p-4">
        <Alert variant="destructive">
          <AlertTitle>Failed to open the dataset</AlertTitle>
          <AlertDescription>{corpus.error.message}</AlertDescription>
        </Alert>
      </ShellMain>
    );
  }
  if (!corpus.data) {
    return (
      <ShellMain className="items-center justify-center">
        <Spinner className="text-muted-foreground" />
      </ShellMain>
    );
  }
  return (
    <CorpusProvider value={corpus.data}>
      <Workspace jobId={id} />
    </CorpusProvider>
  );
}

const FLOATING = "rounded-md border bg-card shadow-sm";

function Workspace({ jobId }: { jobId: string }) {
  const { schema: overview } = useCorpus();
  const { schema, error: schemaError } = useGraphSchema();
  const [chosenType, setChosenType] = useState<string | null>(null);
  // Derived, not synced: the first class the corpus names is drawn until a reader picks another.
  const vertexType = chosenType ?? schema.types[0]?.name ?? null;
  const [selected, setSelected] = useState<SelectedVertex | null>(null);
  const [simulate, setSimulate] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const { look, sim } = useGraphPrefs();
  const view = useCorpusSource(vertexType);

  // The click resolves against the answer the canvas is drawing, which only the api holds.
  const apiRef = useRef<GraphApi | null>(null);
  const onPointClick = useCallback(
    (_vertex: unknown, _graph: unknown, index: number) => {
      const subject = apiRef.current?.slice?.subjects?.[index];
      if (!subject || !vertexType) return;
      setSelected({ id: subject, type: vertexType, label: subject.split(/[/#]/).pop() || subject });
    },
    [vertexType],
  );
  const graph = useGraph({
    source: view.data?.source ?? null,
    look,
    sim,
    simulate,
    onFailure: setFailure,
    events: { onPointClick, onBackgroundClick: () => setSelected(null) },
  });
  useEffect(() => {
    apiRef.current = graph;
  });
  const zoom = (factor: number) => {
    const g = graph.getGraph();
    g?.zoom(g.getZoomLevel() * factor, 300);
  };

  const [activePanel, setActivePanel] = useState<string | null>("info");
  const panels = [
    { id: "info", icon: Info, label: "Info", content: <NodeInfo schema={schema} vertex={selected} /> },
    { id: "ask", icon: MessageCircle, label: "Ask AI", content: <DiscoveryAsk graphSchema={schema} jobId={jobId} /> },
    { id: "rules", icon: ShieldCheck, label: "Rules", content: <RulesPanel jobId={jobId} schema={schema} /> },
    { id: "sql", icon: Terminal, label: "SQL", content: <SqlPanel /> },
    { id: "analysis", icon: BarChart3, label: "Analysis", content: <AnalysisPanel schema={schema} /> },
  ];
  const panel = panels.find((p) => p.id === activePanel);
  const problem = failure ?? view.error?.message ?? schemaError?.message;

  const canvas = (
    <ShellMain className="relative size-full overflow-hidden">
      <GraphRootProvider className="flex-1" value={graph}>
        <div className="absolute start-2 top-2 z-10 max-w-52">
          <ClassLegend
            onChange={setChosenType}
            types={schema.types}
            undrawn={undrawnEdges(view.data?.undrawn, overview)}
            value={vertexType}
          />
        </div>
        <div className="absolute end-2 bottom-2 z-10 flex flex-col gap-1.5">
          <ButtonGroup aria-label="Layout" className={FLOATING} orientation="vertical">
            <Button
              aria-label={simulate ? "Pause the layout" : "Resume the layout"}
              onClick={() => setSimulate((v) => !v)}
              size="icon-sm"
              variant="ghost"
            >
              {simulate ? <Pause /> : <Play />}
            </Button>
          </ButtonGroup>
          <ButtonGroup aria-label="Zoom and fit" className={FLOATING} orientation="vertical">
            <Button aria-label="Zoom in" onClick={() => zoom(1.4)} size="icon-sm" variant="ghost">
              <Plus />
            </Button>
            <ButtonGroupSeparator />
            <Button aria-label="Zoom out" onClick={() => zoom(1 / 1.4)} size="icon-sm" variant="ghost">
              <Minus />
            </Button>
            <ButtonGroupSeparator />
            <Button aria-label="Fit to view" onClick={() => graph.getGraph()?.fitView(500)} size="icon-sm" variant="ghost">
              <Maximize />
            </Button>
          </ButtonGroup>
        </div>
      </GraphRootProvider>
    </ShellMain>
  );

  return (
    <>
      <ShellBody className="min-w-0">
        {panel ? (
          <Resizable
            className="min-h-0"
            defaultSize={[72, 28]}
            panels={[
              { id: "canvas", minSize: 40 },
              { id: "dock", minSize: 18 },
            ]}
          >
            <ResizablePanel className="relative min-w-0 overflow-hidden" id="canvas">
              {canvas}
            </ResizablePanel>
            <ResizableResizeTrigger id="canvas:dock" withHandle />
            <ResizablePanel className="flex min-h-0 min-w-0 flex-col" id="dock">
              <ShellAside aria-label={`${panel.label} panel`} className="size-full min-h-0 border-s-0 bg-card" side="end">
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
                  <span className="font-medium text-sm">{panel.label}</span>
                  <Button
                    aria-label="Close panel"
                    className="-me-1 ms-auto"
                    onClick={() => setActivePanel(null)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col">{panel.content}</div>
              </ShellAside>
            </ResizablePanel>
          </Resizable>
        ) : (
          canvas
        )}
      </ShellBody>

      <ShellFooter className="h-8 flex-row items-center justify-between gap-3 px-2 text-muted-foreground text-xs">
        <div className="flex min-w-0 items-center gap-3 truncate">
          <span className="tabular-nums">
            {schema.types.reduce((sum, t) => sum + t.entityCount, 0).toLocaleString()} nodes
            {" · "}
            {schema.edges.reduce((sum, e) => sum + e.count, 0).toLocaleString()} edges
          </span>
          {graph.sliced && (
            <span className="tabular-nums">
              drawing {graph.slice?.marks.toLocaleString() ?? 0} of {graph.total?.toLocaleString() ?? "?"}
            </span>
          )}
          {problem && <span className="max-w-60 truncate text-destructive">{problem}</span>}
          {selected && <span className="max-w-40 truncate">{selected.label}</span>}
        </div>
        <ToggleGroup
          aria-label="Panels"
          multiple={false}
          onValueChange={(d) => setActivePanel(d.value[0] ?? null)}
          size="sm"
          spacing={2}
          value={activePanel ? [activePanel] : []}
        >
          {panels.map((p) => (
            <ToggleGroupItem aria-label={p.label} key={p.id} value={p.id}>
              <p.icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ShellFooter>
    </>
  );
}
