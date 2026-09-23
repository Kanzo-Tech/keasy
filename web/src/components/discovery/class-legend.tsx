"use client";

import { cn } from "@kanzo-tech/ui";
import { scaleOf } from "@kanzo-tech/graph";
import type { VertexType } from "@/lib/graph-schema";

interface Props {
  types: VertexType[];
  value: string | null;
  onChange: (type: string) => void;
  /** Edges that touch the drawn class and land on another one. */
  undrawnEdges: number;
}

/**
 * The legend, and the choice it stands for.
 *
 * One class is on the canvas at a time because that is what the writer laid out
 * — it places each type separately and only self-relations feed the placement —
 * so the legend is not a set of toggles over one picture, it is which picture.
 * The edges the choice leaves out are said rather than drawn: an unplaced line
 * across a gutter is a claim no force ever made.
 */
export function ClassLegend({ types, value, onChange, undrawnEdges }: Props) {
  const scale = scaleOf({});
  return (
    <div className="rounded-sm border bg-background/80 backdrop-blur-sm p-1 text-xs">
      <ul className="space-y-px">
        {types.map((t, i) => (
          <li key={t.name}>
            <button
              type="button"
              aria-pressed={t.name === value}
              onClick={() => onChange(t.name)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors",
                t.name === value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: scale.color(i) }}
              />
              <span className="flex-1 truncate">{t.name}</span>
              <span className="tabular-nums text-[10px] text-muted-foreground">
                {t.entityCount.toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {undrawnEdges > 0 && (
        <p className="px-1.5 pt-1 text-[10px] text-muted-foreground">
          {undrawnEdges.toLocaleString()} edges to other classes, not drawn
        </p>
      )}
    </div>
  );
}
