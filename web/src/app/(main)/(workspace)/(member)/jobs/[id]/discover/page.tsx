"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Info, MessageCircle, ShieldCheck, Terminal, X } from "lucide-react";
import {
  GraphCanvas,
  GraphInspector,
  GraphLegend,
  GraphRoot,
  GraphToolbar,
  scaleOf,
  useGraphPrefs,
} from "@kanzo-tech/graph";
import { useCrossfilter } from "@kanzo-tech/ui/analytics";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ScrollArea,
  ShellAside,
  ShellBody,
  ShellFooter,
  ShellMain,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { $api } from "@/lib/api/client";
import { AnalysisPanel } from "./_parts/analysis-panel";
import { AskPanel } from "./_parts/ask-panel";
import { ClassLegend } from "./_parts/class-legend";
import { CorpusProvider, corpusQuery, useCorpus, useGraphSchema } from "./_parts/corpus";
import { RulesPanel } from "./_parts/rules-panel";
import { SqlPanel } from "./_parts/sql-panel";

export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = $api.useQuery("get", "/v1/jobs/{id}", { params: { path: { id } } });
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

function Workspace({ jobId }: { jobId: string }) {
  const { corpus } = useCorpus();
  const { schema, error: schemaError } = useGraphSchema();
  const [chosenType, setChosenType] = useState<string | null>(null);
  // Derived, not synced: the first class the corpus names is drawn until a reader picks another.
  const vertexType = chosenType ?? schema.vertices[0]?.name ?? null;
  const [failure, setFailure] = useState<string | null>(null);
  const { look, sim } = useGraphPrefs();
  const crossfilter = useCrossfilter();
  // One class at a time, so the class's own colour is the constant every point wears.
  const typeIndex = schema.vertices.findIndex((t) => t.name === vertexType);
  const identity = corpus.types.vertices.find((t) => t.type === vertexType)?.identity ?? undefined;

  const [activePanel, setActivePanel] = useState<string | null>("info");
  const panels = [
    {
      id: "info",
      icon: Info,
      label: "Info",
      content: (
        <ScrollArea className="h-full">
          <GraphInspector className="p-3" />
        </ScrollArea>
      ),
    },
    { id: "ask", icon: MessageCircle, label: "Ask AI", content: <AskPanel graphSchema={schema} /> },
    { id: "rules", icon: ShieldCheck, label: "Rules", content: <RulesPanel jobId={jobId} schema={schema} /> },
    { id: "sql", icon: Terminal, label: "SQL", content: <SqlPanel /> },
    { id: "analysis", icon: BarChart3, label: "Analysis", content: <AnalysisPanel schema={schema} /> },
  ];
  const panel = panels.find((p) => p.id === activePanel);
  const problem = failure ?? schemaError?.message;

  const canvas = (
    <ShellMain className="relative size-full overflow-hidden">
      <GraphCanvas className="flex-1">
        <ClassLegend
          className="absolute start-2 top-2 z-10 max-w-52"
          onChange={setChosenType}
          schema={schema}
          value={vertexType}
        />
        <GraphToolbar className="absolute end-2 bottom-2 z-10" orientation="vertical" />
        <GraphLegend className="absolute start-2 bottom-2 z-10" />
      </GraphCanvas>
    </ShellMain>
  );

  return (
    <GraphRoot
      corpus={corpus}
      fill={typeIndex >= 0 ? scaleOf({}).color(typeIndex) : undefined}
      filterBy={crossfilter}
      look={look}
      onFailure={setFailure}
      sim={sim}
      simulate
      title={identity}
      type={vertexType ?? undefined}
    >
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
            {schema.vertices.reduce((sum, t) => sum + t.count, 0).toLocaleString()} nodes
            {" · "}
            {schema.edges.reduce((sum, e) => sum + e.count, 0).toLocaleString()} edges
          </span>
          {problem && <span className="max-w-60 truncate text-destructive">{problem}</span>}
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
    </GraphRoot>
  );
}
