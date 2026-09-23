"use client";

import { Maximize, Minus, Pause, Play, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kanzo-tech/ui";
import type { CosmosGraphHandle } from "@fossil-lang/viewer";

interface Props {
  graphRef: React.RefObject<CosmosGraphHandle | null>;
  simulationRunning: boolean;
}

const VIEW_CONTROLS = [
  { key: "in", icon: Plus, label: "Zoom in", action: (g: CosmosGraphHandle | null) => g?.zoomIn(300) },
  { key: "out", icon: Minus, label: "Zoom out", action: (g: CosmosGraphHandle | null) => g?.zoomOut(300) },
  { key: "fit", icon: Maximize, label: "Fit view (F)", action: (g: CosmosGraphHandle | null) => g?.fitView(500) },
] as const;

export function FloatingControls({ graphRef, simulationRunning }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      {VIEW_CONTROLS.map(({ key, icon: Icon, label, action }) => (
        <Tooltip key={key} positioning={{ placement: "left" }}>
          <TooltipTrigger asChild>
            <button
              className="h-6 w-6 inline-flex items-center justify-center rounded-sm bg-background/80 backdrop-blur-sm border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={label}
              onClick={() => action(graphRef.current)}
            >
              <Icon size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{label}</TooltipContent>
        </Tooltip>
      ))}
      <Tooltip positioning={{ placement: "left" }}>
        <TooltipTrigger asChild>
          <button
            className="h-6 w-6 inline-flex items-center justify-center rounded-sm bg-background/80 backdrop-blur-sm border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={simulationRunning ? "Pause (Space)" : "Play (Space)"}
            onClick={() => { if (simulationRunning) graphRef.current?.pause(); else graphRef.current?.start(); }}
          >
            {simulationRunning ? <Pause size={12} /> : <Play size={12} />}
          </button>
        </TooltipTrigger>
        <TooltipContent className="text-xs">{simulationRunning ? "Pause (Space)" : "Play (Space)"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
