"use client";

import { Maximize, Minus, Pause, Play, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CosmosGraphHandle } from "./cosmos-graph";

interface Props {
  graphRef: React.RefObject<CosmosGraphHandle | null>;
  simulationRunning: boolean;
}

export function FloatingControls({ graphRef, simulationRunning }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      {([
        { key: "in", icon: Plus, label: "Zoom in", action: () => graphRef.current?.zoom(1.5, 300) },
        { key: "out", icon: Minus, label: "Zoom out", action: () => graphRef.current?.zoom(0.5, 300) },
        { key: "fit", icon: Maximize, label: "Fit view (F)", action: () => graphRef.current?.fitView(500) },
      ] as const).map(({ key, icon: Icon, label, action }) => (
        <Tooltip key={key}>
          <TooltipTrigger asChild>
            <button
              className="h-6 w-6 inline-flex items-center justify-center rounded-sm bg-background/80 backdrop-blur-sm border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={label}
              onClick={action}
            >
              <Icon size={12} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">{label}</TooltipContent>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="h-6 w-6 inline-flex items-center justify-center rounded-sm bg-background/80 backdrop-blur-sm border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={simulationRunning ? "Pause (Space)" : "Play (Space)"}
            onClick={() => { if (simulationRunning) graphRef.current?.pause(); else graphRef.current?.start(); }}
          >
            {simulationRunning ? <Pause size={12} /> : <Play size={12} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">{simulationRunning ? "Pause (Space)" : "Play (Space)"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
