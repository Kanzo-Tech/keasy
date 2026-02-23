"use client";

import { useState } from "react";
import { Check, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ColumnFilterOption<T extends string> {
  value: T;
  label: string;
}

interface ColumnFilterProps<T extends string> {
  label: string;
  options: ColumnFilterOption<T>[];
  selected: Set<T>;
  onChange: (selected: Set<T>) => void;
}

export function ColumnFilter<T extends string>({
  label,
  options,
  selected,
  onChange,
}: ColumnFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const active = selected.size > 0;

  function toggle(value: T) {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex items-center gap-1">
        {label}
        <ListFilter size={14} className={cn("text-muted-foreground", active && "text-primary")} />
        {active && (
          <span className="bg-primary size-1.5 rounded-full" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        {options.map((opt) => (
          <Button
            key={opt.value}
            variant="ghost"
            size="sm"
            onClick={() => toggle(opt.value)}
            className={cn(
              "w-full justify-start gap-2 font-normal",
              selected.has(opt.value) && "font-medium",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                selected.has(opt.value)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {selected.has(opt.value) && <Check size={10} />}
            </span>
            {opt.label}
          </Button>
        ))}
        {active && (
          <>
            <div className="my-1 border-t" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set())}
              className="w-full justify-start font-normal text-muted-foreground"
            >
              Clear filter
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
