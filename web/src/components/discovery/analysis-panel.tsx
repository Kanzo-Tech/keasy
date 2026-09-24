"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Pencil, Plus, Trash2 } from "lucide-react";
import * as vg from "@uwdata/vgplot";
import type { Selection } from "@uwdata/mosaic-core";
import {
  Button,
  FieldLabel,
  createListCollection,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@kanzo-tech/ui";
import { EmptyState } from "@/components/shared/empty-state";
import { isBinnable, isTemporalType as isTemporal, type GraphSchema } from "@/lib/graph-schema";

// ── Chart config types ───────────────────────────────────────────────────

type Aggregation = "count" | "sum" | "avg" | "min" | "max";

interface ChartConfig {
  id: string;
  tableName: string;
  xField: string;
  xType: string;
  yField: string | null;
  yAgg: Aggregation;
  colorField: string | null;
  hideNulls: boolean;
}

function aggFn(agg: Aggregation, field: string | null) {
  if (agg === "count") return vg.count();
  if (!field) return vg.count();
  switch (agg) {
    case "sum": return vg.sum(field);
    case "avg": return vg.avg(field);
    case "min": return vg.min(field);
    case "max": return vg.max(field);
  }
}

// ── VgChart: renders a single chart config ───────────────────────────────

function VgChart({ config, selection }: { config: ChartConfig; selection: Selection }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const xBinnable = isBinnable(config.xType);
    const xTemporal = isTemporal(config.xType);
    const isScatter = config.yField && config.yAgg !== "count" && xBinnable;

    const marks: unknown[] = [];
    const opts: unknown[] = [];

    if (isScatter && config.yField) {
      // Scatter plot
      marks.push(
        vg.dot(vg.from(config.tableName), { x: config.xField, y: config.yField, fill: "#94a3b8", opacity: 0.3, r: 2 }),
        vg.dot(vg.from(config.tableName, { filterBy: selection }), { x: config.xField, y: config.yField, fill: "steelblue", r: 2 }),
      );
      opts.push(vg.intervalXY({ as: selection }));
    } else if (xTemporal) {
      // Line chart
      marks.push(
        vg.lineY(vg.from(config.tableName), { x: config.xField, y: aggFn(config.yAgg, config.yField), stroke: "#94a3b8", opacity: 0.3 }),
        vg.lineY(vg.from(config.tableName, { filterBy: selection }), { x: config.xField, y: aggFn(config.yAgg, config.yField), stroke: "steelblue" }),
      );
      opts.push(vg.intervalX({ as: selection }));
    } else if (xBinnable) {
      // Histogram
      marks.push(
        vg.rectY(vg.from(config.tableName), { x: vg.bin(config.xField), y: aggFn(config.yAgg, config.yField), fill: "#94a3b8", opacity: 0.3 }),
        vg.rectY(vg.from(config.tableName, { filterBy: selection }), { x: vg.bin(config.xField), y: aggFn(config.yAgg, config.yField), fill: "steelblue" }),
      );
      opts.push(vg.intervalX({ as: selection }));
    } else {
      // Bar chart (categorical)
      marks.push(
        vg.barY(vg.from(config.tableName), { x: config.xField, y: aggFn(config.yAgg, config.yField), fill: "#94a3b8", opacity: 0.3, sort: { x: "-y" }, limit: 10 }),
        vg.barY(vg.from(config.tableName, { filterBy: selection }), { x: config.xField, y: aggFn(config.yAgg, config.yField), fill: "steelblue", sort: { x: "-y" }, limit: 10 }),
      );
      opts.push(vg.toggleX({ as: selection }));
    }

    opts.push(
      vg.height(120),
      vg.marginLeft(30), vg.marginRight(4), vg.marginTop(4), vg.marginBottom(20),
      vg.xAxis("bottom"),
      vg.yAxis(null),
    );

    const plot = vg.plot(...marks, ...opts);
    el.replaceChildren(plot);
    return () => { el.replaceChildren(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.tableName, config.xField, config.xType, config.yField, config.yAgg, config.colorField, config.hideNulls]);

  return <div ref={containerRef} className="w-full" />;
}

// ── Chart editor popover ─────────────────────────────────────────────────

function ChartEditor({
  config,
  schema,
  onChange,
}: {
  config: ChartConfig;
  schema: GraphSchema;
  onChange: (updated: ChartConfig) => void;
}) {
  const fields = useMemo(() => {
    const result: { tableName: string; name: string; type: string; key: string }[] = [];
    for (const t of schema.types) {
      for (const f of schema.fieldsOf(t.name)) {
        if (f.name === "_id" || f.name === "subject") continue;
        result.push({ tableName: t.name, name: f.name, type: f.type, key: `${t.name}.${f.name}` });
      }
    }
    return result;
  }, [schema]);

  const numericFields = useMemo(() => fields.filter((f) => isBinnable(f.type)), [fields]);

  // One collection per control: Ark's Select reads the items rather than its children.
  const xCollection = useMemo(
    () =>
      createListCollection({
        items: fields.map((f) => ({ label: f.name, table: f.tableName, value: f.key })),
      }),
    [fields],
  );
  const yCollection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: "count", value: "__count__" },
          ...numericFields.map((f) => ({ label: f.name, value: f.name })),
        ],
      }),
    [numericFields],
  );
  const aggCollection = useMemo(
    () =>
      createListCollection({
        items: (["count", "sum", "avg", "min", "max"] as const).map((a) => ({
          label: a,
          value: a,
        })),
      }),
    [],
  );
  const colorCollection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: "None", value: "__none__" },
          ...fields
            .filter((f) => !isBinnable(f.type))
            .map((f) => ({ label: f.name, value: f.name })),
        ],
      }),
    [fields],
  );

  return (
    <div className="space-y-2 p-1">
      {/* X-axis */}
      <div className="space-y-1">
        <FieldLabel className="text-[10px] text-muted-foreground">X-axis</FieldLabel>
        <Select
          collection={xCollection}
          onValueChange={(details) => {
            const f = fields.find((field) => field.key === details.value[0]);
            if (f) onChange({ ...config, tableName: f.tableName, xField: f.name, xType: f.type });
          }}
          value={[`${config.tableName}.${config.xField}`]}
        >
          <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {xCollection.items.map((f) => (
              <SelectItem className="text-xs" item={f} key={f.value}>
                {f.label} <span className="text-muted-foreground">({f.table})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Y-axis + Aggregation */}
      <div className="space-y-1">
        <FieldLabel className="text-[10px] text-muted-foreground">Y-axis</FieldLabel>
        <div className="flex gap-0">
          <Select
            collection={yCollection}
            onValueChange={(details) => {
              const picked = details.value[0] ?? "__count__";
              onChange({ ...config, yField: picked === "__count__" ? null : picked });
            }}
            value={[config.yField ?? "__count__"]}
          >
            <SelectTrigger className="h-7 flex-1 rounded-e-none border-e-0 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {yCollection.items.map((f) => (
                <SelectItem className="text-xs" item={f} key={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            collection={aggCollection}
            onValueChange={(details) =>
              onChange({ ...config, yAgg: (details.value[0] ?? "count") as Aggregation })
            }
            value={[config.yAgg]}
          >
            <SelectTrigger className="h-7 w-20 rounded-s-none text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {aggCollection.items.map((a) => (
                <SelectItem className="text-xs" item={a} key={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Color (split-by) */}
      <div className="space-y-1">
        <FieldLabel className="text-[10px] text-muted-foreground">Color (split-by)</FieldLabel>
        <Select
          collection={colorCollection}
          onValueChange={(details) => {
            const picked = details.value[0] ?? "__none__";
            onChange({ ...config, colorField: picked === "__none__" ? null : picked });
          }}
          value={[config.colorField ?? "__none__"]}
        >
          <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {colorCollection.items.map((f) => (
              <SelectItem className="text-xs" item={f} key={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Hide nulls */}
      <div className="flex items-center justify-between pt-1">
        <FieldLabel className="text-[10px]">Hide nulls</FieldLabel>
        <Switch
          checked={config.hideNulls}
          onCheckedChange={(details) => onChange({ ...config, hideNulls: details.checked })}
        />
      </div>
    </div>
  );
}

// ── Analysis Panel ───────────────────────────────────────────────────────

interface AnalysisPanelProps {
  schema: GraphSchema;
  selection: Selection;
}

function generateDefaultCharts(schema: GraphSchema): ChartConfig[] {
  const charts: ChartConfig[] = [];
  for (const t of schema.types) {
    for (const f of schema.fieldsOf(t.name)) {
      if (f.name === "_id" || f.name === "subject") continue;
      if (f.role !== "measure" && f.role !== "dimension") continue;
      charts.push({
        id: crypto.randomUUID(),
        tableName: t.name,
        xField: f.name,
        xType: f.type,
        yField: null,
        yAgg: "count",
        colorField: null,
        hideNulls: false,
      });
      if (charts.length >= 6) return charts;
    }
  }
  return charts;
}

export function AnalysisPanel({ schema, selection }: AnalysisPanelProps) {
  const [charts, setCharts] = useState<ChartConfig[]>(() => generateDefaultCharts(schema));

  const addChart = useCallback(() => {
    const firstType = schema.types[0];
    if (!firstType) return;
    const firstField = schema.fieldsOf(firstType.name).find((f) => f.name !== "_id" && f.name !== "subject");
    if (!firstField) return;
    setCharts((prev) => [...prev, {
      id: crypto.randomUUID(),
      tableName: firstType.name,
      xField: firstField.name,
      xType: firstField.type,
      yField: null,
      yAgg: "count",
      colorField: null,
      hideNulls: false,
    }]);
  }, [schema]);

  const updateChart = useCallback((id: string, updated: ChartConfig) => {
    setCharts((prev) => prev.map((c) => c.id === id ? updated : c));
  }, []);

  const removeChart = useCallback((id: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== id));
  }, []);

  if (charts.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <EmptyState
          icon={BarChart3}
          title="No charts"
          description="Add a chart to analyze your data."
          action={
            <Button variant="outline" size="sm" className="text-xs" onClick={addChart}>
              <Plus size={12} className="mr-1" /> Add chart
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-2">
          {charts.map((chart) => (
            <div key={chart.id} className="group rounded-sm border bg-card overflow-hidden">
              {/* Chart header */}
              <div className="flex items-center justify-between px-2 h-6">
                <span className="text-[10px] text-muted-foreground truncate">
                  {chart.xField}{chart.yField ? ` × ${chart.yField}` : ""}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Popover positioning={{ placement: "bottom-end" }}>
                    <PopoverTrigger asChild>
                      <Button aria-label="Edit chart" className="h-4 w-4" size="icon-sm" variant="ghost"><Pencil size={9} /></Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-2">
                      <ChartEditor config={chart} schema={schema} onChange={(updated) => updateChart(chart.id, updated)} />
                    </PopoverContent>
                  </Popover>
                  <Button aria-label="Remove chart" className="h-4 w-4 text-muted-foreground hover:text-destructive" onClick={() => removeChart(chart.id)} size="icon-sm" variant="ghost">
                    <Trash2 size={9} />
                  </Button>
                </div>
              </div>
              <VgChart config={chart} selection={selection} />
            </div>
          ))}

          <Button variant="link" size="sm" className="text-[10px] h-6" onClick={addChart}>
            <Plus size={10} /> Add chart
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
