"use client";

import { createContext, use, useMemo, type Dispatch, type SetStateAction } from "react";
import { createListCollection, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@kanzo-tech/ui";
import type { Catalog } from "@/lib/fossil/corpus";
import { useCorpus } from "./corpus";

/**
 * Where the graph draws a vertex, as the reader chose it: two numeric columns (`lon` and `lat` draw
 * a map) or neither, and the layout simulates on the GPU; `cluster`, a column the running layout
 * pulls points together by. A view choice, so it is the page's, not the corpus's.
 */
export interface Placement {
  x?: string;
  y?: string;
  cluster?: string;
}

export const PlacementContext = createContext<[Placement, Dispatch<SetStateAction<Placement>>] | null>(null);

function usePlacement() {
  const placement = use(PlacementContext);
  if (!placement) throw new Error("usePlacement must be used within PlacementContext");
  return placement;
}

/** What `GraphRoot` is handed: x and y both or neither — one alone places nothing. */
export function channelsOf({ x, y, cluster }: Placement): Placement {
  return x && y ? { x, y, cluster } : { cluster };
}

const NUMERIC = /^(u?int\d*|float\d*|double|real|decimal|numeric|tinyint|smallint|integer|bigint|hugeint|utinyint|usmallint|uinteger|ubigint)/i;

/** The program's columns over every vertex table, once each by name — fossil's own, with a `role`, left out. */
function columnsOf(catalog: Catalog, numeric: boolean): string[] {
  const names = catalog.vertex_tables.flatMap((t) =>
    t.properties.filter((p) => p.role === undefined && (!numeric || NUMERIC.test(p.type))).map((p) => p.name),
  );
  return [...new Set(names)].sort();
}

const NONE = "\u0000none";

function Pick({ label, columns, value, onChange }: { label: string; columns: string[]; value?: string; onChange: (value?: string) => void }) {
  const collection = useMemo(
    () => createListCollection({ items: [{ label: "None", value: NONE }, ...columns.map((c) => ({ label: c, value: c }))] }),
    [columns],
  );
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-end text-muted-foreground text-xs">{label}</span>
      <Select
        className="min-w-0 flex-1"
        collection={collection}
        onValueChange={(d) => onChange(d.value[0] === NONE ? undefined : d.value[0])}
        positioning={{ sameWidth: true }}
        value={[value ?? NONE]}
      >
        <SelectTrigger aria-label={label} className="h-8 w-full font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {collection.items.map((item) => (
            <SelectItem item={item} key={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The Settings panel's placement: x and y over the numeric columns, cluster over any. */
export function GraphPlacement() {
  const { catalog } = useCorpus();
  const [placement, setPlacement] = usePlacement();
  const numeric = useMemo(() => columnsOf(catalog, true), [catalog]);
  const any = useMemo(() => columnsOf(catalog, false), [catalog]);
  const half = Boolean(placement.x) !== Boolean(placement.y);
  const set = (key: keyof Placement) => (value?: string) => setPlacement((p) => ({ ...p, [key]: value }));
  return (
    <div className="space-y-2">
      <p className="font-medium text-muted-foreground text-xs">Placement</p>
      <Pick columns={numeric} label="x" onChange={set("x")} value={placement.x} />
      <Pick columns={numeric} label="y" onChange={set("y")} value={placement.y} />
      <Pick columns={any} label="cluster" onChange={set("cluster")} value={placement.cluster} />
      <p className="text-[11px] text-muted-foreground leading-snug">
        {half
          ? "Pick both x and y to place by data; until then the layout runs."
          : "With x and y bound, the data places the points and nothing simulates; a table without both is not drawn."}
      </p>
    </div>
  );
}
