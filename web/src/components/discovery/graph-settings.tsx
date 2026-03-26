"use client";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { ChevronRight } from "lucide-react";
import type { GraphConfigInterface } from "@cosmos.gl/graph";
import { DEFAULT_GRAPH_CONFIG } from "./graph-view-v2";

interface Props {
  graphConfig: GraphConfigInterface;
  onConfigChange: (patch: Partial<GraphConfigInterface>) => void;
}

const SIMULATION_PARAMS = [
  { key: "simulationRepulsion", label: "Repulsion", min: 0, max: 2, step: 0.05 },
  { key: "simulationFriction", label: "Friction", min: 0, max: 1, step: 0.05 },
  { key: "simulationGravity", label: "Gravity", min: 0, max: 1, step: 0.05 },
  { key: "simulationDecay", label: "Decay", min: 100, max: 5000, step: 100 },
  { key: "simulationLinkSpring", label: "Link spring", min: 0, max: 1, step: 0.05 },
  { key: "simulationLinkDistance", label: "Link distance", min: 1, max: 100, step: 1 },
  { key: "pointSizeScale", label: "Point size", min: 0.5, max: 5, step: 0.1 },
] as const;

export function GraphSettings({ graphConfig, onConfigChange }: Props) {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Settings" />
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-1 w-full text-[10px] font-medium text-muted-foreground py-1 hover:text-foreground">
              <ChevronRight size={10} className="transition-transform [[data-state=open]>&]:rotate-90" />
              Simulation
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pl-3 pb-2">
              {SIMULATION_PARAMS.map(({ key, label, min, max, step }) => (
                <div key={key} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px]">{label}</Label>
                    <span className="text-[9px] text-muted-foreground tabular-nums font-mono">
                      {(graphConfig[key as keyof GraphConfigInterface] as number)?.toFixed(key === "simulationDecay" || key === "simulationLinkDistance" ? 0 : 2)}
                    </span>
                  </div>
                  <Slider
                    min={min} max={max} step={step}
                    value={[(graphConfig[key as keyof GraphConfigInterface] as number) ?? min]}
                    onValueChange={([v]) => onConfigChange({ [key]: v })}
                  />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-1 w-full text-[10px] font-medium text-muted-foreground py-1 hover:text-foreground">
              <ChevronRight size={10} className="transition-transform [[data-state=open]>&]:rotate-90" />
              Display
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pl-3 pb-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Show links</Label>
                <Switch checked={graphConfig.renderLinks !== false} onCheckedChange={(v) => onConfigChange({ renderLinks: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Scale on zoom</Label>
                <Switch checked={graphConfig.scalePointsOnZoom !== false} onCheckedChange={(v) => onConfigChange({ scalePointsOnZoom: v })} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[10px] h-6 mt-2"
            onClick={() => onConfigChange({
              simulationRepulsion: DEFAULT_GRAPH_CONFIG.simulationRepulsion,
              simulationFriction: DEFAULT_GRAPH_CONFIG.simulationFriction,
              simulationGravity: DEFAULT_GRAPH_CONFIG.simulationGravity,
              simulationDecay: DEFAULT_GRAPH_CONFIG.simulationDecay,
              simulationLinkSpring: DEFAULT_GRAPH_CONFIG.simulationLinkSpring,
              simulationLinkDistance: DEFAULT_GRAPH_CONFIG.simulationLinkDistance,
              pointSizeScale: DEFAULT_GRAPH_CONFIG.pointSizeScale,
              renderLinks: DEFAULT_GRAPH_CONFIG.renderLinks,
              scalePointsOnZoom: DEFAULT_GRAPH_CONFIG.scalePointsOnZoom,
            })}
          >
            Reset defaults
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
