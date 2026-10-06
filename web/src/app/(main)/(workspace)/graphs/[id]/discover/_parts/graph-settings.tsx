"use client";

import type { ReactNode } from "react";
import { Kbd, KbdGroup, PreferencesSections, ScrollArea } from "@kanzo-tech/ui";

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
 * The Settings panel: the graph's section as `@kanzo-tech/ui` draws it (how the graph draws, and
 * where the points come from), and the gestures. `GraphRoot` above answers the section's lists, so the
 * panel names nothing. The graph's settings live here, beside the canvas they change, and not in the
 * app's Preferences. Fitting the view is the toolbar's.
 */
export function GraphSettings() {
  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-4">
        <PreferencesSections namespace="graph" />

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
