"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Code, Wand2 } from "lucide-react";
import type { CreationMode } from "@/lib/types";

interface ModePickerProps {
  onSelect: (mode: CreationMode) => void;
}

export function ModePicker({ onSelect }: ModePickerProps) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-3">
      <p className="text-sm text-muted-foreground">How do you want to create your job?</p>
      <ToggleGroup
        type="single"
        variant="outline"
        onValueChange={(v) => {
          if (v) onSelect(v as CreationMode);
        }}
      >
        <ToggleGroupItem value="studio" className="gap-1.5">
          <Code className="h-4 w-4" />
          Studio
        </ToggleGroupItem>
        <ToggleGroupItem value="assistant" className="gap-1.5">
          <Wand2 className="h-4 w-4" />
          Assistant
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
