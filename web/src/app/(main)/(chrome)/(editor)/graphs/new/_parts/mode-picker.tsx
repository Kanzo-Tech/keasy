"use client";

import {
  Badge,
  Button,
  Float,
  RadioGroup,
  RadioGroupCard,
  RadioGroupIndicator,
  RadioGroupText,
} from "@kanzo-tech/ui";
import { ArrowLeft, Code, Wand2 } from "lucide-react";
import { lower, WORDS } from "@/lib/vocabulary";
import type { CreationMode } from "./graph-editor-store";

/** How the program gets written, asked once before the studio opens. */
export function ModePicker({ onSelect, onBack }: { onSelect: (mode: CreationMode) => void; onBack: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <Button className="absolute start-3 top-3" onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft />
        Back
      </Button>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="font-heading font-semibold text-xl">New {lower(WORDS.graph)}</h1>
        <p className="text-muted-foreground text-sm">How do you want to write its {lower(WORDS.recipe)}?</p>
      </div>

      <RadioGroup
        className="w-full max-w-[30rem]"
        columns={2}
        onValueChange={(d) => d.value && onSelect(d.value as CreationMode)}
      >
        <RadioGroupCard className="items-start" value="studio">
          <Code className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <RadioGroupText>Studio</RadioGroupText>
            <span className="text-muted-foreground text-xs leading-snug">
              Write the mapping yourself, in the editor.
            </span>
          </div>
          <RadioGroupIndicator className="order-last mt-0.5 ms-auto" />
        </RadioGroupCard>

        <div className="relative">
          <RadioGroupCard className="h-full items-start" value="assistant">
            <Wand2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <RadioGroupText>Assistant</RadioGroupText>
              <span className="text-muted-foreground text-xs leading-snug">
                Describe the result and let it draft the program.
              </span>
            </div>
            <RadioGroupIndicator className="order-last mt-0.5 ms-auto" />
          </RadioGroupCard>
          <Float className="-end-2 -top-2" placement="top-end">
            <Badge size="xs" variant="secondary">
              Beta
            </Badge>
          </Float>
        </div>
      </RadioGroup>
    </div>
  );
}
