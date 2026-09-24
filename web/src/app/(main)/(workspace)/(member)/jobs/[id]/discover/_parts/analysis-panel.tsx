"use client";

import { useMemo, useState } from "react";
import { BarChart3, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  createListCollection,
  FieldLabel,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
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
import { isBinnable, isTemporalType, type FieldInfo, type GraphSchema } from "@/lib/graph-schema";

const AGGREGATIONS = ["count", "sum", "avg", "min", "max"] as const;
type Aggregation = (typeof AGGREGATIONS)[number];

interface ChartSpec {
  id: string;
  table: string;
  x: string;
  xType: string;
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
  const frame = { height: 120, margin: { top: 4, right: 4, bottom: 20, left: 30 }, table: spec.table };
  const axes = [<ChartAxisX key="x" label={null} />, <ChartAxisY anchor={null} key="y" />];

  if (spec.y && spec.agg !== "count" && isBinnable(spec.xType)) {
    return (
      <ChartRoot {...frame}>
        <ChartDot {...BEHIND} fill={MUTED} r={2} x={spec.x} y={spec.y} />
        <ChartDot fill={ACCENT} r={2} x={spec.x} y={spec.y} />
        <ChartIntervalXY />
        {axes}
      </ChartRoot>
    );
  }
  if (isTemporalType(spec.xType)) {
    return (
      <ChartRoot {...frame}>
        <ChartLineY {...BEHIND} stroke={MUTED} x={spec.x} y={y} />
        <ChartLineY stroke={ACCENT} x={spec.x} y={y} />
        <ChartIntervalX />
        {axes}
      </ChartRoot>
    );
  }
  if (isBinnable(spec.xType)) {
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

interface Field extends FieldInfo {
  table: string;
}

function chartable(schema: GraphSchema): Field[] {
  return schema.types.flatMap((t) =>
    schema
      .fieldsOf(t.name)
      .filter((f) => f.name !== "_id" && f.name !== "subject")
      .map((f) => ({ ...f, table: t.name })),
  );
}

const specOf = (f: Field): ChartSpec => ({
  id: crypto.randomUUID(),
  table: f.table,
  x: f.name,
  xType: f.type,
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
          ...fields.filter((f) => isBinnable(f.type)).map((f) => ({ label: f.name, value: f.name })),
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
            if (f) onChange({ ...spec, table: f.table, x: f.name, xType: f.type });
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

export function AnalysisPanel({ schema }: { schema: GraphSchema }) {
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
      <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
        <ItemMedia className="text-muted-foreground" variant="icon">
          <BarChart3 />
        </ItemMedia>
        <ItemTitle>No charts</ItemTitle>
        <ItemDescription>Add a chart to analyze your data.</ItemDescription>
        <ItemActions>
          <Button disabled={!fields[0]} onClick={add} size="sm" variant="outline">
            <Plus /> Add chart
          </Button>
        </ItemActions>
      </Item>
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
