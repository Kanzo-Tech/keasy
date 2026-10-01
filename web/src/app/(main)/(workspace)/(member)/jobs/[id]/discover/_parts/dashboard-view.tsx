"use client";

import { useMemo, useState } from "react";
import { PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  createListCollection,
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
  Skeleton,
  StatLabel,
  StatRoot,
  StatValue,
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
  Query,
  sum,
  useChartQuery,
  useCrossfilter,
} from "@kanzo-tech/ui/analytics";
import { verbatim } from "@uwdata/mosaic-sql";
import { useCorpus, useFieldStats } from "./corpus";
import { ChartCard, DashboardGrid, FilterChips, useClauses } from "./dashboard-frames";
import type { FieldKind, FieldStat, TableStats } from "./field-stats";
import { Boundary } from "@/components/boundary";

/**
 * The Dashboard view — kanzo-ui's `workspace` showcase's Sightings region, over the corpus: one
 * filter row above everything it scopes, a tile per vertex type, and a grid of charts, all reading
 * the crossfilter the graph reads. A lasso on the canvas filters every chart here, and a brush here
 * dims the canvas.
 */

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
  const frame = { height: 190, margin: { top: 8, right: 12, bottom: 24, left: 40 }, table };
  const axes = [<ChartAxisX key="x" label={null} />, <ChartAxisY grid key="y" label={null} />];

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

function chartable(tables: TableStats[]): Field[] {
  return tables.flatMap((t) => t.fields.filter((f) => f.role !== "identifier").map((f) => ({ ...f, table: t.name })));
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
          ...fields
            .filter((f) => f.table === spec.table && f.kind === "numeric")
            .map((f) => ({ label: f.name, value: f.name })),
        ],
      }),
    [fields, spec.table],
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
            if (f) onChange({ ...spec, table: f.table, x: f.name, xKind: f.kind, y: f.table === spec.table ? spec.y : null });
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

/** One vertex type's rows under the current crossfilter, against all of them. */
function TypeTile({ name, total }: { name: string; total: number }) {
  const { relation } = useCorpus();
  const shown = useChartQuery({
    deps: [name],
    query: (filter) => Query.from(verbatim(relation(name))).select({ n: count() }).where(filter),
  });
  const n = shown.row ? Number(shown.row.n) : null;
  return (
    <StatRoot>
      <StatLabel>{name}</StatLabel>
      <StatValue loading={n === null}>
        {n === null || n === total ? total.toLocaleString() : `${n.toLocaleString()} of ${total.toLocaleString()}`}
      </StatValue>
    </StatRoot>
  );
}

/** One filter row above everything it scopes: what the crossfilter holds, and a way to clear it. */
function FilterBar() {
  const crossfilter = useCrossfilter();
  const clauses = useClauses(crossfilter);
  return (
    <section aria-label="Filters" className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="text-muted-foreground text-xs">
        {clauses.length === 0 ? "Nothing filtered — brush a chart or select on the graph." : "Filtered by"}
      </span>
      <FilterChips className="flex flex-wrap items-center gap-2" selection={crossfilter} />
      <Button
        className="ms-auto"
        disabled={clauses.length === 0}
        onClick={() => crossfilter.reset()}
        size="sm"
        variant="ghost"
      >
        <RotateCcwIcon />
        Clear filters
      </Button>
    </section>
  );
}

function BootSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton className="h-24 w-full rounded-lg" key={i} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 w-full rounded-lg xl:col-span-2" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function DashboardView() {
  return (
    <Boundary className="p-4" fallback={<BootSkeleton />}>
      <Stats />
    </Boundary>
  );
}

function Stats() {
  return <Dashboard tables={useFieldStats()} />;
}

function Dashboard({ tables }: { tables: TableStats[] }) {
  const { manifest } = useCorpus();
  const fields = useMemo(() => chartable(tables), [tables]);
  // The first six measures and dimensions to start; the reader's own from then on.
  const [charts, setCharts] = useState<ChartSpec[]>(() => fields.slice(0, 6).map(specOf));

  const update = (next: ChartSpec) => setCharts(charts.map((c) => (c.id === next.id ? next : c)));
  const add = () => fields[0] && setCharts([...charts, specOf(fields[0])]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4">
        <FilterBar />
        <DashboardGrid minColumnWidth={200}>
          {manifest.vertex_tables.map((t) => (
            <TypeTile key={t.name} name={t.name} total={t.record_count} />
          ))}
        </DashboardGrid>
        <DashboardGrid minColumnWidth={380}>
          {charts.map((spec) => (
            <ChartCard
              action={
                <div className="flex items-center">
                  <Popover positioning={{ placement: "bottom-end" }}>
                    <PopoverTrigger asChild>
                      <Button aria-label="Edit chart" size="icon-sm" variant="ghost">
                        <PencilIcon />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64">
                      <ChartEditor fields={fields} onChange={update} spec={spec} />
                    </PopoverContent>
                  </Popover>
                  <Button
                    aria-label="Remove chart"
                    onClick={() => setCharts(charts.filter((c) => c.id !== spec.id))}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              }
              description={spec.table}
              key={spec.id}
              title={spec.y && spec.agg !== "count" ? `${spec.agg} of ${spec.y} by ${spec.x}` : `${spec.x}`}
            >
              <Chart spec={spec} />
            </ChartCard>
          ))}
        </DashboardGrid>
        <div>
          <Button disabled={!fields[0]} onClick={add} size="sm" variant="outline">
            <PlusIcon /> Add chart
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}
