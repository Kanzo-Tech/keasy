"use client";

import { cn, Swatch, ToggleGroup, ToggleGroupItem } from "@kanzo-tech/ui";
import { scaleOf, useGraphState } from "@kanzo-tech/graph";
import type { SchemaResult } from "@fossil-lang/corpus";

/**
 * Which class is on the canvas, and what that choice leaves out.
 *
 * One class is on the canvas at a time because that is what the writer laid out, so this is not a
 * set of toggles over one picture, it is which picture. The relations the graph declined are said
 * rather than drawn, and fossil's two reasons are different news — one is this canvas' shape, the
 * other is a hole in the corpus — so they are two lines rather than one total.
 */
export function ClassLegend({
  schema,
  value,
  onChange,
  className,
}: {
  schema: SchemaResult;
  value: string | null;
  onChange: (type: string) => void;
  className?: string;
}) {
  const declined = useGraphState((s) => s.declined);
  const scale = scaleOf({});
  const undrawn = { "other-space": 0, "not-declared": 0 };
  const counted = new Set<string>();
  for (const gap of declined) {
    if (counted.has(gap.edgeType)) continue;
    counted.add(gap.edgeType);
    undrawn[gap.reason] += schema.edges
      .filter((e) => e.name === gap.edgeType && (e.source_type === value || e.target_type === value))
      .reduce((sum, e) => sum + e.count, 0);
  }

  return (
    <div className={cn("rounded-md border bg-card p-1 text-xs shadow-sm", className)}>
      <ToggleGroup
        aria-label="Vertex class"
        className="w-full flex-col items-stretch"
        deselectable={false}
        onValueChange={(d) => d.value[0] && onChange(d.value[0])}
        orientation="vertical"
        size="sm"
        value={value ? [value] : []}
      >
        {schema.vertices.map((t, i) => (
          <ToggleGroupItem className="justify-start gap-1.5 px-1.5 text-xs" key={t.name} value={t.name}>
            <Swatch color={scale.color(i)} shape="round" size="xs" />
            <span className="flex-1 truncate text-start">{t.name}</span>
            <span className="text-muted-foreground tabular-nums">{t.count.toLocaleString()}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {undrawn["other-space"] > 0 && (
        <p className="px-1.5 pt-1 text-muted-foreground">
          {undrawn["other-space"].toLocaleString()} edges to other classes, not drawn
        </p>
      )}
      {undrawn["not-declared"] > 0 && (
        <p className="px-1.5 pt-0.5 text-muted-foreground">
          {undrawn["not-declared"].toLocaleString()} edges of this class publish no adjacency
        </p>
      )}
    </div>
  );
}
