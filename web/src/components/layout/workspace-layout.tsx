"use client";

import { useState, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import {
  Button,
  Resizable,
  ResizablePanel,
  ResizableResizeTrigger,
  ShellAside,
  ShellBody,
  ShellFooter,
  ShellMain,
  ToggleGroup,
  ToggleGroupItem,
} from "@kanzo-tech/ui";

export interface PanelDef {
  id: string;
  icon: LucideIcon;
  label: string;
  content: ReactNode;
}

/**
 * The full-screen canvas with a docked inspector — the kanzo-ui workspace showcase's
 * arrangement. The canvas and the dock are the two panels of a `Resizable`, so the app
 * sidebar stays outside the splitter and the canvas reflows when the rail collapses.
 * The footer strip picks the dock's panel; clicking the active one again closes it.
 */
export function WorkspaceLayout({
  children,
  panels,
  statusLeft,
  defaultPanel = "info",
}: {
  children: ReactNode;
  panels: PanelDef[];
  statusLeft?: ReactNode;
  defaultPanel?: string;
}) {
  const [active, setActive] = useState<string | null>(defaultPanel);
  const panel = panels.find((p) => p.id === active);
  const canvas = <ShellMain className="relative size-full overflow-hidden">{children}</ShellMain>;

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
              <ShellAside
                aria-label={`${panel.label} panel`}
                className="size-full min-h-0 border-s-0 bg-card"
                side="end"
              >
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
                  <span className="text-sm font-medium">{panel.label}</span>
                  <Button
                    aria-label="Close panel"
                    className="-me-1 ms-auto"
                    onClick={() => setActive(null)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
                <div className="min-h-0 flex-1">{panel.content}</div>
              </ShellAside>
            </ResizablePanel>
          </Resizable>
        ) : (
          canvas
        )}
      </ShellBody>

      <ShellFooter className="h-8 flex-row items-center justify-between gap-3 px-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-3 truncate">{statusLeft}</div>
        <ToggleGroup
          aria-label="Panels"
          multiple={false}
          onValueChange={(d) => setActive(d.value[0] ?? null)}
          size="sm"
          spacing={2}
          value={active ? [active] : []}
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
