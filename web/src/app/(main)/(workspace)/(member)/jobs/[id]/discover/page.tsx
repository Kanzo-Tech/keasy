"use client";

import dynamic from "next/dynamic";
import { createContext, use, useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  BarChart3Icon,
  InfoIcon,
  MessageCircleIcon,
  NetworkIcon,
  Settings2Icon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import {
  GraphCanvas,
  GraphCounts,
  GraphLegend,
  GraphRoot,
  GraphToolbar,
  useGraphPrefs,
  useGraphState,
} from "@kanzo-tech/graph";
import { useCrossfilter } from "@kanzo-tech/ui/analytics";
import {
  Badge,
  Button,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  ShellBody,
  ShellFooter,
  ShellMain,
  Show,
  Skeleton,
  Spinner,
  Status,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";
import { HeaderEnd } from "@/app/(main)/_parts/header-end";
import { AskPanel } from "./_parts/ask-panel";
import { CorpusProvider, corpusQuery, useCorpus } from "./_parts/corpus";
import { GraphInfo } from "./_parts/graph-info";
import { GraphSettings } from "./_parts/graph-settings";
import { RulesPanel } from "./_parts/rules-panel";
import { Boundary } from "@/components/boundary";
import { ProblemView } from "@/components/problem-view";
import { toProblem } from "@/lib/errors";
import { settled } from "@/lib/api/settled";

/**
 * Discovery, composed as kanzo-ui's `workspace` showcase: the header picks what `ShellMain` shows
 * (Graph · Dashboard), the footer strip picks which panel the dock holds (Info · Ask · Rules ·
 * Settings) and collapses it when the active icon is pressed again. Both views and every panel read
 * one graph and one crossfilter, so a lasso on the canvas filters the dashboard and a rule pressed in
 * the dock lights the canvas.
 */

// vgplot evaluated during the prerender is a TDZ, so the dashboard loads client-only.
const DashboardView = dynamic(() => import("./_parts/dashboard-view"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

const PANELS = [
  { id: "info", label: "Info", icon: InfoIcon },
  { id: "ask", label: "Ask", icon: MessageCircleIcon },
  { id: "rules", label: "Rules", icon: ShieldCheckIcon },
  { id: "settings", label: "Settings", icon: Settings2Icon },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

const PANEL_BODY: Record<PanelId, React.ComponentType> = {
  info: GraphInfo,
  ask: AskPanel,
  rules: RulesPanel,
  settings: GraphSettings,
};

const VIEWS = [
  { id: "graph", label: "Graph", icon: NetworkIcon },
  { id: "dashboard", label: "Dashboard", icon: BarChart3Icon },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Opening the corpus is the one door: a missing job (404), one that has not completed (409) and an
  // unreadable output all fail it, and the boundary shows that failure in place of the workspace.
  return (
    <Boundary
      fallback={
        <ShellMain className="items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </ShellMain>
      }
      frame={(failure) => <ShellMain className="p-4">{failure}</ShellMain>}
    >
      <Opened id={id} />
    </Boundary>
  );
}

function Opened({ id }: { id: string }) {
  const corpus = settled(useSuspenseQuery(corpusQuery(id)));
  return (
    <CorpusProvider value={corpus}>
      <Workspace />
    </CorpusProvider>
  );
}

/**
 * What the graph last failed with, as it was thrown: fossil's `FossilError` for a read, kanzo-ui's
 * `GraphError` (`graph/no-webgl`, `graph/context-lost`, `graph/nothing-to-draw`, …) for its own.
 */
const GraphFailure = createContext<unknown>(undefined);

function GraphRegion() {
  const failed = useGraphState((s) => s.status === "failed");
  const failure = use(GraphFailure);
  return (
    <ShellMain className="relative size-full bg-background">
      <GraphCanvas className="absolute inset-0">
        <GraphToolbar className="absolute end-2 top-2 z-10" />
        <GraphLegend className="absolute start-2 bottom-2 z-10" />
        <Show when={failed && failure !== undefined}>
          <div className="absolute inset-0 z-20 grid place-items-center p-6">
            <ProblemView className="w-full max-w-xl" problem={toProblem(failure)} />
          </div>
        </Show>
      </GraphCanvas>
    </ShellMain>
  );
}

function DashboardRegion() {
  return (
    <ShellMain className="min-h-0 bg-background">
      <DashboardView />
    </ShellMain>
  );
}

/** The footer: how much of the corpus is drawn, and where the graph is in its life. */
function CorpusStatus() {
  const status = useGraphState((s) => s.status);
  return (
    <span className="flex min-w-0 items-center gap-2 px-1 text-muted-foreground text-xs">
      <Badge className="gap-1.5" size="xs" variant="outline">
        <Status
          className="ring-0"
          size="sm"
          variant={status === "idle" ? "success" : status === "failed" ? "destructive" : "info"}
        />
        {status}
      </Badge>
      <GraphCounts className="truncate" />
    </span>
  );
}

function Workspace() {
  const { corpus, manifest } = useCorpus();
  const { look } = useGraphPrefs();
  // Colour by type, ranked in the manifest's order so a type keeps its colour as rows arrive.
  const categories = useMemo(
    () => Object.fromEntries(manifest.vertex_tables.map((t) => [t.name, t.name])),
    [manifest],
  );
  const crossfilter = useCrossfilter();
  const [active, setActive] = useState<PanelId>("info");
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState<ViewId>("graph");
  const [failure, setFailure] = useState<unknown>(undefined);

  const ActiveBody = PANEL_BODY[active];
  const activeLabel = PANELS.find((p) => p.id === active)?.label ?? "";
  const MainRegion = view === "graph" ? GraphRegion : DashboardRegion;

  return (
    <GraphFailure value={failure}>
    <GraphRoot
      categories={categories}
      corpus={corpus}
      filterBy={crossfilter}
      look={look}
      onFailure={setFailure}
    >
      <HeaderEnd>
        {/* Switching to the dashboard closes the dock: a dashboard is judged at full width. Reopen it
            from the footer strip. */}
        <ToggleGroup
          aria-label="View"
          multiple={false}
          onValueChange={(d) => {
            const next = d.value[0] as ViewId | undefined;
            if (!next) return;
            setView(next);
            if (next === "dashboard") setPanelOpen(false);
          }}
          size="sm"
          spacing={2}
          value={[view]}
        >
          {VIEWS.map((v) => (
            <ToggleGroupItem key={v.id} value={v.id}>
              <v.icon />
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </HeaderEnd>

      <ShellBody className="min-w-0">
        <Show fallback={<MainRegion />} when={panelOpen}>
          <Resizable
            className="min-h-0"
            defaultSize={[72, 28]}
            panels={[
              { id: "canvas", minSize: 40 },
              { id: "dock", minSize: 18 },
            ]}
          >
            <ResizablePanel className="relative min-w-0 overflow-hidden" id="canvas">
              <MainRegion />
            </ResizablePanel>
            <ResizableResizeTrigger id="canvas:dock" withHandle />
            <ResizablePanel className="flex min-h-0 min-w-0 flex-col" id="dock">
              <ShellAside
                aria-label={`${activeLabel} panel`}
                className="size-full min-h-0 border-s-0 bg-card"
                side="end"
              >
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
                  <span className="font-medium text-sm">{activeLabel}</span>
                  <div className="ms-auto flex items-center gap-1">
                    <Button
                      aria-label="Close panel"
                      className="-me-1"
                      onClick={() => setPanelOpen(false)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {/* Keyed by panel, so a failed panel does not stay failed under the next one. */}
                  <Boundary
                    className="p-3"
                    fallback={<Skeleton className="m-3 h-40" />}
                    key={active}
                  >
                    <ActiveBody />
                  </Boundary>
                </div>
              </ShellAside>
            </ResizablePanel>
          </Resizable>
        </Show>
      </ShellBody>

      <ShellFooter className="h-8 flex-row items-center justify-between px-2">
        <CorpusStatus />
        {/* Single-select and deselectable: clicking the active icon again collapses the dock. */}
        <ToggleGroup
          aria-label="Panels"
          multiple={false}
          onValueChange={(d) => {
            const next = d.value[0] as PanelId | undefined;
            if (next) {
              setActive(next);
              setPanelOpen(true);
            } else {
              setPanelOpen(false);
            }
          }}
          size="sm"
          spacing={2}
          value={panelOpen ? [active] : []}
        >
          {PANELS.map((p) => (
            <ToggleGroupItem aria-label={p.label} key={p.id} value={p.id}>
              <p.icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ShellFooter>
    </GraphRoot>
    </GraphFailure>
  );
}
