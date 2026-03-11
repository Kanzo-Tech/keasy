"use client";

import type { ComponentType, CSSProperties } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface RadioCardOption {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  badge?: string;
  previewText?: string;
  previewClassName?: string;
  previewStyle?: CSSProperties;
}

interface RadioCardGroupProps {
  name: string;
  value: string;
  onValueChange: (v: string) => void;
  options: readonly RadioCardOption[];
  disabled?: boolean;
}

export function RadioCardGroup({
  name,
  value,
  onValueChange,
  options,
  disabled,
}: RadioCardGroupProps) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      className="grid grid-cols-3 gap-3"
    >
      {options.map((opt) => {
        const id = `rc-${name}-${opt.value}`;
        const Icon = opt.icon;
        const isDisabled = disabled || opt.disabled;
        return (
          <Label
            key={opt.value}
            htmlFor={id}
            className={cn(
              "flex flex-col items-center justify-center text-center gap-2 py-4 px-3 rounded-md border cursor-pointer transition-colors",
              isDisabled && "opacity-50 cursor-not-allowed",
              value === opt.value
                ? "border-primary bg-accent"
                : "border-border hover:bg-accent/50",
            )}
          >
            <RadioGroupItem
              value={opt.value}
              id={id}
              disabled={isDisabled}
              className="sr-only"
            />
            {Icon && <Icon className="h-6 w-6 text-muted-foreground" />}
            {opt.previewText && (
              <span
                className={cn("h-8 flex items-center leading-none", opt.previewClassName)}
                style={opt.previewStyle}
              >
                {opt.previewText}
              </span>
            )}
            <span className="text-xs font-medium">{opt.label}</span>
            {opt.disabled && opt.badge && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {opt.badge}
              </Badge>
            )}
          </Label>
        );
      })}
    </RadioGroup>
  );
}
