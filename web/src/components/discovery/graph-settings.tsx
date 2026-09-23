"use client";

import { useMemo } from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  FieldLabel,
  ScrollArea,
  Slider,
  Switch,
} from "@kanzo-tech/ui";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { ChevronRight } from "lucide-react";
import { lookFrom, simFrom, type LookPatch, type Sim } from "@kanzo-tech/graph";

interface Props {
  sim: Partial<Sim>;
  look: LookPatch;
  onSimChange: (patch: Partial<Sim>) => void;
  onLookChange: (patch: LookPatch) => void;
}

const SIMULATION_PARAMS = [
  { key: "repulsion", label: "Repulsion", min: 0, max: 2, step: 0.05 },
  { key: "friction", label: "Friction", min: 0, max: 1, step: 0.05 },
  { key: "gravity", label: "Gravity", min: 0, max: 1, step: 0.05 },
  { key: "cluster", label: "Cluster", min: 0, max: 1, step: 0.05 },
  { key: "linkSpring", label: "Link spring", min: 0, max: 1, step: 0.05 },
  { key: "linkDistance", label: "Link distance", min: 1, max: 100, step: 1 },
] as const satisfies readonly { key: keyof Sim; label: string; min: number; max: number; step: number }[];

export function GraphSettings({ sim, look, onSimChange, onLookChange }: Props) {
  // The library merges a patch on its own side; a panel showing a number has to
  // do the same merge to know which number to show.
  const values = useMemo(() => ({ ...simFrom(), ...sim }), [sim]);
  const resolved = useMemo(
    () => ({ ...lookFrom(), ...look, link: { ...lookFrom().link, ...look.link } }),
    [look],
  );

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
                    <FieldLabel className="text-[10px]">{label}</FieldLabel>
                    <span className="text-[9px] text-muted-foreground tabular-nums font-mono">
                      {values[key].toFixed(key === "linkDistance" ? 0 : 2)}
                    </span>
                  </div>
                  <Slider
                    min={min} max={max} step={step}
                    value={[values[key]]}
                    onValueChange={(details) => onSimChange({ ...sim, [key]: details.value[0] })}
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
                <FieldLabel className="text-[10px]">Show links</FieldLabel>
                <Switch
                  checked={resolved.link.render}
                  onCheckedChange={(details) =>
                    onLookChange({ ...look, link: { ...look.link, render: details.checked } })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <FieldLabel className="text-[10px]">Grid</FieldLabel>
                <Switch
                  checked={resolved.grid}
                  onCheckedChange={(details) => onLookChange({ ...look, grid: details.checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <FieldLabel className="text-[10px]">Vignette</FieldLabel>
                <Switch
                  checked={resolved.vignette}
                  onCheckedChange={(details) => onLookChange({ ...look, vignette: details.checked })}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[10px] h-6 mt-2"
            onClick={() => {
              onSimChange({});
              onLookChange({});
            }}
          >
            Reset defaults
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
