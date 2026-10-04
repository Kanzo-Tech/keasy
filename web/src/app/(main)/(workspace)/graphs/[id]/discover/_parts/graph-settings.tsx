"use client";

import { createContext, use, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Kbd, KbdGroup, ScrollArea } from "@kanzo-tech/ui";
import { type Channels, GraphLooks, GraphPlacement } from "@kanzo-tech/graph";

/**
 * Where the graph draws a vertex, as the reader chose it: a view choice, so it is the page's, not the
 * corpus's. The page hands it to `GraphRoot`; this panel edits it.
 */
export type Placement = Pick<Channels, "x" | "y" | "cluster">;

export const PlacementContext = createContext<[Placement, Dispatch<SetStateAction<Placement>>] | null>(null);

function usePlacement() {
  const placement = use(PlacementContext);
  if (!placement) throw new Error("usePlacement must be used within PlacementContext");
  return placement;
}

/** What a gesture does, as a legend rather than a paragraph. */
const GESTURES: { keys: ReactNode; what: string }[] = [
  { keys: <Kbd>Drag</Kbd>, what: "Pan the canvas, or move a node" },
  { keys: <Kbd>Wheel</Kbd>, what: "Zoom where you point" },
  { keys: <Kbd>Click</Kbd>, what: "Focus a node together with its neighbours" },
  {
    keys: (
      <KbdGroup>
        <Kbd>Shift</Kbd>
        <Kbd>Drag</Kbd>
      </KbdGroup>
    ),
    what: "Marquee, without picking a tool first",
  },
  { keys: <Kbd>⌘ / Ctrl</Kbd>, what: "Add what you draw to the selection" },
  { keys: <Kbd>Alt</Kbd>, what: "Remove it from the selection instead" },
  {
    keys: (
      <KbdGroup>
        <Kbd>⌘ / Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    ),
    what: "Search the graph",
  },
  { keys: <Kbd>Esc</Kbd>, what: "Back out — the drag, then the tool, then the selection" },
];

/**
 * The Settings panel: how the graph draws (`GraphLooks`, the looks and their axes), where the points
 * come from (`GraphPlacement`), and the gestures. The graph's settings live here, beside the canvas
 * they change, and not in the app's Preferences. Fitting the view is the toolbar's.
 */
export function GraphSettings() {
  const [placement, setPlacement] = usePlacement();
  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-4">
        <GraphLooks />
        <GraphPlacement onChange={setPlacement} value={placement} />

        <div className="space-y-2 border-t pt-3">
          <p className="font-medium text-muted-foreground text-xs">Gestures</p>
          <dl className="space-y-1.5">
            {GESTURES.map((gesture) => (
              <div className="flex items-baseline gap-2" key={gesture.what}>
                <dt className="shrink-0">{gesture.keys}</dt>
                <dd className="text-[11px] text-muted-foreground leading-snug">{gesture.what}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </ScrollArea>
  );
}
