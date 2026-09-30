"use client";

import type { ReactNode } from "react";
import { MaximizeIcon } from "lucide-react";
import { Button, Kbd, KbdGroup, PreferencesSections, ScrollArea } from "@kanzo-tech/ui";
import { useGraphContext } from "@kanzo-tech/graph";

/** What a gesture does, as a legend rather than a paragraph. */
const GESTURES: { keys: ReactNode; what: string }[] = [
  { keys: <Kbd>Drag</Kbd>, what: "Pan the canvas — or pin a node where you drop it, if you grab one" },
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
  { keys: <Kbd>Esc</Kbd>, what: "Back out — the drag, then the tool, then the selection" },
];

/**
 * The Settings panel — the camera, how the graph draws, and the gestures. The graph's settings live
 * here, beside the canvas they change, and not in the app's Preferences: the drawing axes are the
 * ones `@kanzo-tech/graph/section` declares, drawn by the library from that declaration.
 */
export function GraphSettings() {
  const { fit } = useGraphContext();

  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="font-medium text-muted-foreground text-xs">Camera</p>
          <Button className="w-full" onClick={() => fit()} size="sm" variant="outline">
            <MaximizeIcon />
            Fit to view
          </Button>
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="font-medium text-muted-foreground text-xs">Drawing</p>
          {/* The picture's half of the section; the forces are a live layout's, and discovery draws
              the corpus's own positions. */}
          <PreferencesSections
            namespace="graph"
            only={["marks", "links", "labels", "additive-links", "bowed-links", "vignette", "grid"]}
          />
        </div>

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
