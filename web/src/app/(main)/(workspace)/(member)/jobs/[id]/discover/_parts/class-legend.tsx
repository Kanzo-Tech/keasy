"use client";

import { Swatch, ToggleGroup, ToggleGroupItem } from "@kanzo-tech/ui";
import { scaleOf } from "@kanzo-tech/graph";
import type { VertexType } from "@/lib/graph-schema";
import type { UndrawnSummary } from "./corpus-source";

/**
 * The legend, and the choice it stands for.
 *
 * One class is on the canvas at a time because that is what the writer laid out, so the legend is
 * not a set of toggles over one picture, it is which picture. The edges the choice leaves out are
 * said rather than drawn, and the two reasons the reader gives are different news — one is this
 * canvas' shape, the other is a hole in the corpus — so they are two lines rather than one total.
 */
export function ClassLegend({
  types,
  value,
  onChange,
  undrawn,
}: {
  types: VertexType[];
  value: string | null;
  onChange: (type: string) => void;
  undrawn: UndrawnSummary;
}) {
  const scale = scaleOf({});
  return (
    <div className="rounded-md border bg-card p-1 text-xs shadow-sm">
      <ToggleGroup
        aria-label="Vertex class"
        className="w-full flex-col items-stretch"
        deselectable={false}
        onValueChange={(d) => d.value[0] && onChange(d.value[0])}
        orientation="vertical"
        size="sm"
        value={value ? [value] : []}
      >
        {types.map((t, i) => (
          <ToggleGroupItem className="justify-start gap-1.5 px-1.5 text-xs" key={t.name} value={t.name}>
            <Swatch color={scale.color(i)} shape="round" size="xs" />
            <span className="flex-1 truncate text-start">{t.name}</span>
            <span className="text-muted-foreground tabular-nums">{t.entityCount.toLocaleString()}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {undrawn.otherClasses > 0 && (
        <p className="px-1.5 pt-1 text-muted-foreground">
          {undrawn.otherClasses.toLocaleString()} edges to other classes, not drawn
        </p>
      )}
      {undrawn.notDeclared > 0 && (
        <p className="px-1.5 pt-0.5 text-muted-foreground">
          {undrawn.notDeclared.toLocaleString()} edges of this class publish no adjacency
        </p>
      )}
    </div>
  );
}
