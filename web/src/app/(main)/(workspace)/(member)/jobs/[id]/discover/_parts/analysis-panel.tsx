"use client";

import { useMemo, useState } from "react";
import { BarChart3, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  createListCollection,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
  FieldLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@kanzo-tech/ui";
import {
  avg,
  bin,
  ChartAxisX,
  ChartAxisY,
  ChartBarY,
  ChartDot,
  ChartIntervalX,
  ChartIntervalXY,
  ChartLineY,
  ChartRectY,
  ChartRoot,
  ChartToggleX,
  count,
  max,
  min,
  sum,
} from "@kanzo-tech/ui/analytics";
import { verbatim } from "@uwdata/mosaic-sql";
import type { FieldKind, FieldStat, SchemaResult } from "@fossil-lang/corpus";
import { useCorpus } from "./corpus";

const AGGREGATIONS = ["count", "sum", "avg", "min", "max"] as const;
type Aggregation = (typeof AGGREGATIONS)[number];

interface ChartSpec {
  id: string;
  /** The vertex type; the chart reads the relation the corpus names it by. */
  table: string;
  x: string;
  xKind: FieldKind;
  /** `null` counts rows. */
  y: string | null;
  agg: Aggregation;
}

const AGGREGATE = { sum, avg, min, max };

// The whole relation behind, the current crossfilter in front.
const BEHIND = { filterBy: null, opacity: 0.22 };
const MUTED = "var(--muted-foreground)";
const ACCENT = "var(--chart-1)";

function Chart({ spec }: { spec: ChartSpec }) {
  const y = spec.agg === "count" || !spec.y ? count() : AGGREGATE[spec.agg](spec.y);
  const { relation } = useCorpus();
  // The corpus's relation is `"<catalog>"."Person"`, already quoted; a bare string would be read as
  // one identifier, so it rides `verbatim` as the rule engine's queries do.
  const table = verbatim(relation(spec.table));
  const frame = { height: 120, margin: { top: 4, right: 4, bottom: 20, left: 30 }, table };
  const axes = [<ChartAxisX key="x" label={null} />, <ChartAxisY anchor={null} key="y" />];

  if (spec.y && spec.agg !== "count" && spec.xKind !== "categorical") {
    return (
      <ChartRoot {...frame}>
        <ChartDot {...BEHIND} fill={MUTED} r={2} x={spec.x} y={spec.y} />
        <ChartDot fill={ACCENT} r={2} x={spec.x} y={spec.y} />
        <ChartIntervalXY />
        {axes}
      </ChartRoot>
    );
  }
  if (spec.xKind === "temporal") {
    return (
      <ChartRoot {...frame}>
        <ChartLineY {...BEHIND} stroke={MUTED} x={spec.x} y={y} />
        <ChartLineY stroke={ACCENT} x={spec.x} y={y} />
        <ChartIntervalX />
        {axes}
      </ChartRoot>
    );
  }
  if (spec.xKind !== "categorical") {
    return (
      <ChartRoot {...frame}>
        <ChartRectY {...BEHIND} fill={MUTED} x={bin(spec.x)} y={y} />
        <ChartRectY fill={ACCENT} x={bin(spec.x)} y={y} />
        <ChartIntervalX />
        {axes}
      </ChartRoot>
    );
  }
  return (
    <ChartRoot {...frame}>
      <ChartBarY {...BEHIND} fill={MUTED} limit={10} sort={{ x: "-y" }} x={spec.x} y={y} />
      <ChartBarY fill={ACCENT} limit={10} sort={{ x: "-y" }} x={spec.x} y={y} />
      <ChartToggleX />
      {axes}
    </ChartRoot>
  );
}

interface Field extends FieldStat {
  table: string;
}

function chartable(schema: SchemaResult): Field[] {
  return schema.vertices.flatMap((t) =>
    t.stats.filter((f) => f.name !== "_id" && f.name !== "subject").map((f) => ({ ...f, table: t.name })),
  );
}

const specOf = (f: Field): ChartSpec => ({
  id: crypto.randomUUID(),
  table: f.table,
  x: f.name,
  xKind: f.kind,
  y: null,
  agg: "count",
});

function ChartEditor({
  spec,
  fields,
  onChange,
}: {
  spec: ChartSpec;
  fields: Field[];
  onChange: (spec: ChartSpec) => void;
}) {
  const xs = useMemo(
    () =>
      createListCollection({
        items: fields.map((f) => ({ label: f.name, table: f.table, value: `${f.table}.${f.name}` })),
      }),
    [fields],
  );
  const ys = useMemo(
    () =>
      createListCollection({
        items: [
          { label: "count", value: "" },
          ...fields.filter((f) => f.kind !== "categorical").map((f) => ({ label: f.name, value: f.name })),
        ],
      }),
    [fields],
  );
  const aggs = useMemo(
    () => createListCollection({ items: AGGREGATIONS.map((a) => ({ label: a, value: a })) }),
    [],
  );

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <FieldLabel className="text-xs">X-axis</FieldLabel>
        <Select
          collection={xs}
          onValueChange={(d) => {
            const f = fields.find((field) => `${field.table}.${field.name}` === d.value[0]);
            if (f) onChange({ ...spec, table: f.table, x: f.name, xKind: f.kind });
          }}
          value={[`${spec.table}.${spec.x}`]}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {xs.items.map((f) => (
              <SelectItem item={f} key={f.value}>
                {f.label} <span className="text-muted-foreground">({f.table})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <FieldLabel className="text-xs">Y-axis</FieldLabel>
        <div className="flex gap-1">
          <Select
            className="flex-1"
            collection={ys}
            onValueChange={(d) => onChange({ ...spec, y: d.value[0] || null })}
            value={[spec.y ?? ""]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ys.items.map((f) => (
                <SelectItem item={f} key={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            className="w-24"
            collection={aggs}
            onValueChange={(d) => onChange({ ...spec, agg: (d.value[0] ?? "count") as Aggregation })}
            value={[spec.agg]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {aggs.items.map((a) => (
                <SelectItem item={a} key={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function AnalysisPanel({ schema }: { schema: SchemaResult }) {
  const fields = useMemo(() => chartable(schema), [schema]);
  const [charts, setCharts] = useState<ChartSpec[]>(() =>
    fields
      .filter((f) => f.role === "measure" || f.role === "dimension")
      .slice(0, 6)
      .map(specOf),
  );
  const add = () => fields[0] && setCharts((prev) => [...prev, specOf(fields[0])]);

  if (charts.length === 0) {
    return (
      <EmptyRoot>
        <EmptyHeader>
          <EmptyIndicator variant="icon">
            <BarChart3 />
          </EmptyIndicator>
          <EmptyTitle asChild>
            <h3>No charts</h3>
          </EmptyTitle>
          <EmptyDescription>Add a chart to analyze your data.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button disabled={!fields[0]} onClick={add} size="sm" variant="outline">
            <Plus /> Add chart
          </Button>
        </EmptyContent>
      </EmptyRoot>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-2">
        {charts.map((spec) => (
          <div className="group rounded-md border bg-card" key={spec.id}>
            <div className="flex h-7 items-center justify-between ps-2 pe-1">
              <span className="truncate text-muted-foreground text-xs">
                {spec.x}
                {spec.y ? ` × ${spec.y}` : ""}
              </span>
              <div className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                <Popover positioning={{ placement: "bottom-end" }}>
                  <PopoverTrigger asChild>
                    <Button aria-label="Edit chart" size="icon-sm" variant="ghost">
                      <Pencil />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <ChartEditor
                      fields={fields}
                      onChange={(next) => setCharts((prev) => prev.map((c) => (c.id === spec.id ? next : c)))}
                      spec={spec}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  aria-label="Remove chart"
                  onClick={() => setCharts((prev) => prev.filter((c) => c.id !== spec.id))}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="px-1 pb-1">
              <Chart spec={spec} />
            </div>
          </div>
        ))}
        <Button onClick={add} size="sm" variant="ghost">
          <Plus /> Add chart
        </Button>
      </div>
    </ScrollArea>
  );
}
