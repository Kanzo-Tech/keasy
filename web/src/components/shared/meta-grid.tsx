import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MetaItem } from "@/components/shared/meta-item";

export interface MetaGridItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
  /** Render value inside a Badge with optional icon. */
  badge?: { icon?: ReactNode; variant?: "default" | "outline" | "secondary" };
  /** Mask value as `••••` (used for password-format fields). */
  secret?: boolean;
}

interface MetaGridProps {
  items: MetaGridItem[];
  className?: string;
}

/**
 * Canonical key/value grid for detail views (connection, job, org).
 * Replaces the hand-rolled 3-column grids that each detail page had.
 */
export function MetaGrid({ items, className }: MetaGridProps) {
  return (
    <div
      className={cn(
        "grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => {
        if (item.badge) {
          return (
            <div key={item.label} className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <Badge variant={item.badge.variant ?? "outline"} className="gap-1.5">
                {item.badge.icon}
                {item.value}
              </Badge>
            </div>
          );
        }
        const display = item.secret ? "••••" : item.value;
        return (
          <MetaItem
            key={item.label}
            label={item.label}
            value={typeof display === "string" ? display : String(display ?? "")}
            mono={!item.secret && item.mono}
          />
        );
      })}
    </div>
  );
}
