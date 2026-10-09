"use client";

import dynamic from "next/dynamic";
import { createContext, use, useMemo, useState } from "react";
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
  GraphStatus,
  GraphToolbar,
  useGraphPrefs,
  useGraphState,
} from "@kanzo-tech/graph";
import {
  FilterBar,
  MosaicClients,
  relationQuery,
  TileEditorAside,
  useCrossfilter,
  useMosaic,
  useTileEditorOpen,
  type Relation,
} from "@kanzo-tech/ui/analytics";
import {
  Button,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  ShellBody,
  ShellFooter,
  ShellMain,
  Show,
  SidebarIntent,
  Skeleton,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  useSidebar,
} from "@kanzo-tech/ui";
import { HeaderEnd } from "@/app/(main)/_parts/header-end";
import { AskPanel } from "./_parts/ask-panel";
import { CorpusProvider, useCorpus, useJoinGraph } from "@/lib/fossil/corpus";
import { GraphInfo } from "./_parts/graph-info";
import { GraphSettings } from "./_parts/graph-settings";
import { RulesPanel } from "./_parts/rules-panel";
import { useDiscoverState, type PanelId, type ViewId } from "./_parts/discover-url";
import { Boundary } from "@/components/boundary";
import { ProblemView } from "@/components/problem-view";
import { toastError } from "@/lib/errors";

/**
 * Discovery, composed as kanzo-ui's `workspace` showcase: the header picks what `ShellMain` shows
 * (Graph · Dashboard), the footer strip picks which panel the dock holds (Info · Ask · Rules ·
 * Settings) and collapses it when the active icon is pressed again. Both views and every panel read
 * one graph and one crossfilter, so a lasso on the canvas filters the dashboard and a rule pressed in
 * the dock lights the canvas. `FilterBar`, under the header, is every clause on the page in either
 * view, and the dashboard's filter controls in Dashboard. A dashboard tile is edited in the Format aside at the body's
 * end edge, beside the dock rather than in it, so the panel the reader had open stays open. The view
 * and the dock's panel are the URL's (`./_parts/discover-url`), so a link opens the page as it was
 * left; writing them replaces the URL in place, and neither view is remounted by it.
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
] as const satisfies readonly { id: PanelId; label: string; icon: React.ComponentType }[];

const PANEL_BODY: Record<PanelId, React.ComponentType> = {
  info: GraphInfo,
  ask: AskPanel,
  rules: RulesPanel,
  settings: GraphSettings,
};

const VIEWS = [
  { id: "graph", label: "Graph", icon: NetworkIcon },
  { id: "dashboard", label: "Dashboard", icon: BarChart3Icon },
] as const satisfies readonly { id: ViewId; label: string; icon: React.ComponentType }[];

export default function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Opening the corpus is the one door: a missing graph (404), one that has not completed (409) and an
  // unreadable output all fail it, and the boundary shows that failure in place of the workspace.
  return (
    <>
      {/* Discovery is judged at full width: the sidebar collapses while it is shown, and the
          person's own preference returns when they leave. */}
      <SidebarIntent collapsed />
      <Boundary
        fallback={
          <ShellMain className="items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </ShellMain>
        }
        frame={(failure) => <ShellMain className="p-4">{failure}</ShellMain>}
      >
        <CorpusProvider graphId={id}>
          <Workspace />
        </CorpusProvider>
      </Boundary>
    </>
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
    <GraphCanvas className="absolute inset-0">
      <GraphToolbar className="absolute end-2 top-2 z-10" />
      <GraphLegend className="absolute start-2 bottom-2 z-10" />
      <Show when={failed && failure !== undefined}>
        <div className="absolute inset-0 z-20 grid place-items-center p-6">
          <ProblemView className="w-full max-w-xl" error={failure} />
        </div>
      </Show>
    </GraphCanvas>
  );
}

/**
 * The Dashboard view's aside for its tile editor — draw.io's Format panel, shown while a tile is
 * edited and the dashboard is the view. It stays mounted, hidden, because a page without a
 * `TileEditorAside` offers no editing, and because the draft is the hidden dashboard's: Graph view
 * hides the editor with its board, and Dashboard brings both back as they were. A phone draws it
 * over the view.
 */
function FormatAside({ shown }: { shown: boolean }) {
  const { isMobile } = useSidebar();
  return (
    // `z-10` over the overlay's `z-5`: a table tile's sticky header in the view is `z-10` too, and
    // the aside comes after it.
    <ShellAside aria-label="Format" className="z-10 bg-card" hidden={!(useTileEditorOpen() && shown)} overlay={isMobile} side="end" width={352}>
      <TileEditorAside />
    </ShellAside>
  );
}

/** The footer: where the graph is, and how much of it is drawn. */
function CorpusStatus() {
  return (
    <span className="flex min-w-0 items-center gap-2 px-1 text-muted-foreground text-xs">
      <GraphStatus />
      <GraphCounts className="truncate" />
    </span>
  );
}

function Workspace() {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  const { look, sim, placement } = useGraphPrefs();
  const crossfilter = useCrossfilter();
  const graph = useJoinGraph();
  const [relation, setRelation] = useState<Relation>(() => ({ root: graph.types[0]?.name ?? "", path: [] }));
  const table = useMemo(() => relationQuery(graph, relation), [graph, relation]);
  const [{ view, panel }, setDiscover] = useDiscoverState();
  const panelOpen = panel !== "none";
  // The dock's width while it is open; closed, it collapses to nothing and the main region stays
  // mounted where it is, so the dashboard keeps what the reader filtered.
  const [sizes, setSizes] = useState([72, 28]);
  const [failure, setFailure] = useState<unknown>(undefined);

  const ActiveBody = panelOpen ? PANEL_BODY[panel] : undefined;
  const activeLabel = PANELS.find((p) => p.id === panel)?.label ?? "";

  return (
    <GraphFailure value={failure}>
    <GraphRoot
      coordinator={coordinator}
      filterBy={crossfilter}
      from={graphId}
      look={look}
      sim={sim}
      onFailure={(error) => {
        // A canvas that cannot draw shows why in its own region; a selection or search that failed
        // leaves the graph drawn, so the toast is where it is said.
        setFailure(error);
        toastError(error, "The graph could not do that");
      }}
      {...placement}
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
            setDiscover(next === "dashboard" ? { view: next, panel: "none" } : { view: next });
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

      {/* The readout is the view's: the dashboard's relation in Dashboard, and in Graph none, because
          what the clauses leave of the graph is the footer's GraphCounts and the legend's rows. */}
      <FilterBar
        className="shrink-0 border-b px-3 py-1.5"
        rowNoun={relation.path.length ? "paths" : relation.root}
        table={view === "dashboard" ? table : undefined}
      />

      <ShellBody className="min-w-0">
        <Resizable
          className="min-h-0"
          onCollapse={() => setDiscover({ panel: "none" })}
          // A collapse is not a width to come back to.
          onResize={(d) => d.size[1] > 0 && setSizes(d.size)}
          panels={[
            { id: "canvas", minSize: 40 },
            { id: "dock", minSize: 18, collapsible: true, collapsedSize: 0 },
          ]}
          size={panelOpen ? sizes : [100, 0]}
        >
          <ResizablePanel className="relative min-w-0 overflow-hidden" id="canvas">
            <ShellMain className="relative size-full min-h-0 bg-background">
              {view === "graph" && <GraphRegion />}
              {/* Hidden, not unmounted, in Graph view: its filters keep filtering the page and stay in
                  the bar as removable chips (their editing controls leave it until Dashboard is
                  shown), and its charts ask nothing until it is shown again. */}
              <MosaicClients enabled={view === "dashboard"}>
                <div className="size-full min-h-0" hidden={view !== "dashboard"}>
                  <DashboardView onRelationChange={setRelation} relation={relation} table={table} />
                </div>
              </MosaicClients>
            </ShellMain>
          </ResizablePanel>
          <ResizableResizeTrigger hidden={!panelOpen} id="canvas:dock" withHandle />
          <ResizablePanel className="flex min-h-0 min-w-0 flex-col" id="dock">
            {ActiveBody && (
              <ShellAside
                aria-label={`${activeLabel} panel`}
                className="size-full min-h-0 border-s-0 bg-card"
                side="end"
              >
                <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border px-3 py-1">
                  <span className="shrink-0 font-medium text-sm">{activeLabel}</span>
                  <Button
                    aria-label="Close panel"
                    className="-me-1 ms-auto"
                    onClick={() => setDiscover({ panel: "none" })}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <XIcon />
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  {/* Keyed by panel, so a failed panel does not stay failed under the next one. */}
                  <Boundary className="p-3" fallback={<Skeleton className="m-3 h-40" />} key={panel}>
                    <ActiveBody />
                  </Boundary>
                </div>
              </ShellAside>
            )}
          </ResizablePanel>
        </Resizable>
        <FormatAside shown={view === "dashboard"} />
      </ShellBody>

      <ShellFooter className="h-8 flex-row items-center justify-between px-2">
        <CorpusStatus />
        {/* Single-select and deselectable: clicking the active icon again collapses the dock. */}
        <ToggleGroup
          aria-label="Panels"
          multiple={false}
          onValueChange={(d) => {
            const next = d.value[0] as PanelId | undefined;
            setDiscover({ panel: next ?? "none" });
          }}
          size="sm"
          spacing={2}
          value={panelOpen ? [panel] : []}
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
