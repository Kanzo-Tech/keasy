import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  steps: readonly string[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          {i > 0 && <div className="h-px w-4 bg-border" />}
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              i === current
                ? "text-foreground"
                : i < current
                  ? "text-muted-foreground"
                  : "text-muted-foreground/50",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                i === current
                  ? "bg-primary text-primary-foreground"
                  : i < current
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted/50 text-muted-foreground/50",
              )}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
