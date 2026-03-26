"use client";

import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface StatusBarPanelButton {
  id: string;
  icon: LucideIcon;
  label: string;
}

interface Props {
  left?: React.ReactNode;
  panels: StatusBarPanelButton[];
  activePanel: string | null;
  onPanelToggle: (id: string) => void;
}

export function WorkspaceStatusBar({ left, panels, activePanel, onPanelToggle }: Props) {
  return (
    <div className="h-6 shrink-0 border-t bg-muted flex items-center justify-between px-2 text-[11px] text-muted-foreground select-none">
      <div className="flex items-center gap-3 min-w-0 truncate">
        {left}
      </div>
      <div className="flex items-center gap-0.5">
        {panels.map(({ id, icon: Icon, label }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "h-5 w-5 inline-flex items-center justify-center rounded-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                  activePanel === id && "bg-accent text-accent-foreground",
                )}
                aria-label={label}
                aria-pressed={activePanel === id}
                onClick={() => onPanelToggle(id)}
              >
                <Icon size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
