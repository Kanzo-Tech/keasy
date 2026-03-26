"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Pencil, Plus, Trash2 } from "lucide-react";
import * as vg from "@uwdata/vgplot";
import type { Selection } from "@uwdata/mosaic-core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/shared/empty-state";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { NUMERIC_DUCKDB_TYPES, TEMPORAL_DUCKDB_TYPES, type GraphSchema } from "@/lib/graph-schema";

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

// ── Helpers ──────────────────────────────────────────────────────────────

function isBinnable(type: string): boolean {
  const upper = type.toUpperCase().replace(/\(.*\)/, "").trim();
  return NUMERIC_DUCKDB_TYPES.has(upper) || TEMPORAL_DUCKDB_TYPES.has(upper);
}

function isTemporal(type: string): boolean {
  return TEMPORAL_DUCKDB_TYPES.has(type.toUpperCase().replace(/\(.*\)/, "").trim());
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

  return (
    <div className="space-y-2 p-1">
      {/* X-axis */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">X-axis</Label>
        <Select
          value={`${config.tableName}.${config.xField}`}
          onValueChange={(v) => {
            const f = fields.find((f) => f.key === v);
            if (f) onChange({ ...config, tableName: f.tableName, xField: f.name, xType: f.type });
          }}
        >
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.key} value={f.key} className="text-xs">{f.name} <span className="text-muted-foreground">({f.tableName})</span></SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Y-axis + Aggregation */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Y-axis</Label>
        <div className="flex gap-0">
          <Select
            value={config.yField ?? "__count__"}
            onValueChange={(v) => onChange({ ...config, yField: v === "__count__" ? null : v })}
          >
            <SelectTrigger className="h-7 text-xs rounded-r-none border-r-0 flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__count__" className="text-xs">count</SelectItem>
              {numericFields.map((f) => (
                <SelectItem key={f.key} value={f.name} className="text-xs">{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={config.yAgg} onValueChange={(v) => onChange({ ...config, yAgg: v as Aggregation })}>
            <SelectTrigger className="h-7 text-xs rounded-l-none w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["count", "sum", "avg", "min", "max"] as const).map((a) => (
                <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Color (split-by) */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Color (split-by)</Label>
        <Select
          value={config.colorField ?? "__none__"}
          onValueChange={(v) => onChange({ ...config, colorField: v === "__none__" ? null : v })}
        >
          <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__" className="text-xs">None</SelectItem>
            {fields.filter((f) => !isBinnable(f.type)).map((f) => (
              <SelectItem key={f.key} value={f.name} className="text-xs">{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Hide nulls */}
      <div className="flex items-center justify-between pt-1">
        <Label className="text-[10px]">Hide nulls</Label>
        <Switch
          checked={config.hideNulls}
          onCheckedChange={(v) => onChange({ ...config, hideNulls: v })}
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
        <PanelHeader title="Analysis" />
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
      <PanelHeader title="Analysis" />
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-4 w-4"><Pencil size={9} /></Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-2" align="end">
                      <ChartEditor config={chart} schema={schema} onChange={(updated) => updateChart(chart.id, updated)} />
                    </PopoverContent>
                  </Popover>
                  <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground hover:text-destructive" onClick={() => removeChart(chart.id)}>
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
