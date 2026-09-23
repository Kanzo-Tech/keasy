"use client";

import {
  Badge,
  Float,
  RadioGroup,
  RadioGroupCard,
  RadioGroupIndicator,
  RadioGroupText,
} from "@kanzo-tech/ui";
import { Code, Wand2 } from "lucide-react";
import type { CreationMode } from "@/lib/types";

/**
 * How the program gets written, asked once before the studio opens.
 *
 * Two bare toggle buttons under a line of prose is what this was. Cards carry the
 * one thing the choice actually needs: what each mode does. And "Assistant" is
 * disabled with the reason ON the control rather than leaving `disabled` to mean
 * whatever a reader guesses.
 */
export function ModePicker({ onSelect }: { onSelect: (mode: CreationMode) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="font-heading font-semibold text-xl">New job</h1>
        <p className="text-muted-foreground text-sm">How do you want to build it?</p>
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
