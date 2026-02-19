"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Settings2 } from "lucide-react";
import {
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { chartJobData } from "@/lib/api";
import type { ChartWidget as ChartWidgetType, ChartType } from "@/lib/dashboard-store";
import type { FieldSchema } from "@/components/dashboard-builder";

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "Bar",
  line: "Line",
  area: "Area",
  pie: "Pie",
  scatter: "Scatter",
};

const AGGREGATION_OPTIONS = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Avg" },
];

const COLORS = [
  "var(--primary)", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#14b8a6",
];

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function isNumeric(type: string): boolean {
  return type === "Int" || type === "Float";
}

export function isCategorical(type: string): boolean {
  return type === "String" || type === "Bool";
}

interface ChartWidgetProps {
  widget: ChartWidgetType;
  jobId: string;
  schema: FieldSchema[];
  onChange: (updated: ChartWidgetType) => void;
  onRemove: () => void;
}

export function ChartWidget({ widget, jobId, schema, onChange, onRemove }: ChartWidgetProps) {
  const [chartData, setChartData] = useState<Record<string, string | number>[]>([]);
  const [queryLoading, setQueryLoading] = useState(false);

  const fieldMap = useMemo(() => {
    const m: Record<string, FieldSchema> = {};
    for (const f of schema) m[f.name] = f;
    return m;
  }, [schema]);

  // Type-aware column filtering
  const xColumns = useMemo(() => {
    if (widget.type === "scatter") return schema.filter((f) => isNumeric(f.type));
    if (widget.type === "pie") return schema.filter((f) => isCategorical(f.type));
    return schema;
  }, [schema, widget.type]);

  const yColumns = useMemo(() => {
    return schema.filter((f) => isNumeric(f.type));
  }, [schema]);

  const groupByColumns = useMemo(() => {
    return schema.filter((f) => isCategorical(f.type) && f.name !== widget.xAxis);
  }, [schema, widget.xAxis]);

  const showYAxis = widget.type !== "pie";
  const showGroupBy = widget.type !== "pie" && widget.type !== "scatter";
  const showAggregation = showYAxis && showGroupBy && !!widget.yAxis;

  // Derive aggregation for API
  const effectiveAggregation = useMemo(() => {
    if (widget.type === "scatter") return "none";
    if (widget.type === "pie") return "count";
    if (!widget.yAxis) return "count";
    return widget.aggregation ?? "count";
  }, [widget.type, widget.yAxis, widget.aggregation]);

  useEffect(() => {
    const xField = fieldMap[widget.xAxis];
    if (!xField) {
      setChartData([]);
      return;
    }

    const yField = widget.yAxis ? fieldMap[widget.yAxis] : undefined;
    const groupField = widget.groupBy ? fieldMap[widget.groupBy] : undefined;

    setQueryLoading(true);
    chartJobData(jobId, {
      x_predicate: xField.iri,
      y_predicate: yField?.iri,
      group_predicate: groupField?.iri,
      aggregation: effectiveAggregation,
    })
      .then((result) => {
        if (widget.groupBy && result.rows.length > 0) {
          const groups = new Map<string, Map<string, number>>();
          for (const row of result.rows) {
            const x = String(row.x ?? "");
            const group = String(row.group ?? "other");
            const value = Number(row.value ?? row.count ?? 0);
            if (!groups.has(x)) groups.set(x, new Map());
            groups.get(x)!.set(group, value);
          }
          const data: Record<string, string | number>[] = [];
          for (const [x, gm] of groups) {
            const point: Record<string, string | number> = { [widget.xAxis]: x };
            for (const [g, v] of gm) point[sanitizeKey(g)] = v;
            data.push(point);
          }
          setChartData(data);
        } else if (widget.type === "pie") {
          setChartData(
            result.rows.map((r) => ({
              name: String(r.x ?? ""),
              value: Number(r.value ?? r.count ?? 0),
            }))
          );
        } else {
          setChartData(
            result.rows.map((r) => {
              const point: Record<string, string | number> = {
                [widget.xAxis]: r.x ?? "",
              };
              if (widget.yAxis) {
                point[sanitizeKey(widget.yAxis)] = r.y ?? r.value ?? "";
              }
              return point;
            })
          );
        }
      })
      .catch(() => setChartData([]))
      .finally(() => setQueryLoading(false));
  }, [jobId, widget.xAxis, widget.yAxis, widget.groupBy, widget.type, fieldMap, effectiveAggregation]);

  const groupKeys = useMemo(() => {
    if (!widget.groupBy || chartData.length === 0) return [];
    const keys = new Set<string>();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== widget.xAxis) keys.add(k);
      }
    }
    return [...keys];
  }, [chartData, widget.groupBy, widget.xAxis]);

  const yKey = widget.yAxis
    ? sanitizeKey(widget.yAxis)
    : groupKeys.length > 0
      ? sanitizeKey(groupKeys[0])
      : "value";

  const chartConfig: ChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    if (widget.type === "pie") {
      chartData.forEach((d, i) => {
        config[sanitizeKey(String(d.name))] = { label: String(d.name), color: COLORS[i % COLORS.length] };
      });
    } else if (groupKeys.length > 0) {
      groupKeys.forEach((key, i) => {
        config[sanitizeKey(key)] = { label: key, color: COLORS[i % COLORS.length] };
      });
    } else {
      const key = widget.yAxis ?? "value";
      config[sanitizeKey(key)] = { label: key, color: COLORS[0] };
    }
    return config;
  }, [widget.type, widget.yAxis, groupKeys, chartData]);

  const configParts: string[] = [];
  if (widget.xAxis) configParts.push(`X: ${widget.xAxis}`);
  if (showYAxis && widget.yAxis) configParts.push(`Y: ${widget.yAxis}`);
  if (showGroupBy && widget.groupBy) configParts.push(`Group: ${widget.groupBy}`);
  if (showAggregation) configParts.push(`Agg: ${widget.aggregation ?? "count"}`);

  return (
    <Card className="py-4 gap-3 shadow-none">
      <CardHeader className="px-4 py-0">
        <CardTitle className="flex items-center gap-2">
          <Input
            className="text-sm font-medium bg-transparent border-transparent rounded-none shadow-none flex-1 min-w-0 h-auto p-0 focus-visible:ring-0 focus-visible:border-border"
            value={widget.title}
            onChange={(e) => onChange({ ...widget, title: e.target.value })}
            placeholder="Chart title..."
          />
          <Badge variant="secondary">{CHART_TYPE_LABELS[widget.type]}</Badge>
        </CardTitle>
        <CardAction className="flex items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Settings2 size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">X Axis</Label>
                <Select value={widget.xAxis || ""} onValueChange={(v) => onChange({ ...widget, xAxis: v })}>
                  <SelectTrigger className="w-full text-xs">
                    <SelectValue placeholder="Select column..." />
                  </SelectTrigger>
                  <SelectContent>
                    {xColumns.map((f) => (
                      <SelectItem key={f.name} value={f.name}>
                        <span className="flex items-center gap-2">
                          {f.name}
                          <span className="text-[10px] text-muted-foreground">{f.type}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {showYAxis && (
                <div className="space-y-2">
                  <Label className="text-xs">Y Axis</Label>
                  <Select
                    value={widget.yAxis ?? "__none__"}
                    onValueChange={(v) => onChange({ ...widget, yAxis: v === "__none__" ? undefined : v })}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(none)</SelectItem>
                      {yColumns.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          <span className="flex items-center gap-2">
                            {f.name}
                            <span className="text-[10px] text-muted-foreground">{f.type}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {showGroupBy && (
                <div className="space-y-2">
                  <Label className="text-xs">Group By</Label>
                  <Select
                    value={widget.groupBy ?? "__none__"}
                    onValueChange={(v) => onChange({ ...widget, groupBy: v === "__none__" ? undefined : v })}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select column..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">(none)</SelectItem>
                      {groupByColumns.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          <span className="flex items-center gap-2">
                            {f.name}
                            <span className="text-[10px] text-muted-foreground">{f.type}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {showAggregation && (
                <div className="space-y-2">
                  <Label className="text-xs">Aggregation</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    value={widget.aggregation ?? "count"}
                    onValueChange={(v) => { if (v) onChange({ ...widget, aggregation: v }); }}
                  >
                    {AGGREGATION_OPTIONS.map((o) => (
                      <ToggleGroupItem key={o.value} value={o.value} className="text-xs px-3">
                        {o.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onRemove}>
            <X size={14} />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="px-4 py-0 space-y-3">
        {queryLoading ? (
          <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin mr-1.5" />
            Loading...
          </div>
        ) : chartData.length > 0 && widget.xAxis ? (
          <ChartContainer config={chartConfig} className="h-64 w-full">
            {renderChart(widget, chartData, yKey, groupKeys)}
          </ChartContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">
            Select axes to render chart
          </div>
        )}

        {configParts.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {configParts.join("  \u00b7  ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function renderChart(
  widget: ChartWidgetType,
  data: Record<string, string | number>[],
  yKey: string,
  groupKeys: string[],
) {
  const commonProps = { data, margin: { top: 5, right: 20, bottom: 5, left: 0 } };

  switch (widget.type) {
    case "bar":
      return (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey={widget.xAxis} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {groupKeys.length > 0 ? (
            groupKeys.map((key) => (
              <Bar key={key} dataKey={sanitizeKey(key)} fill={`var(--color-${sanitizeKey(key)})`} />
            ))
          ) : (
            <Bar dataKey={yKey} fill={`var(--color-${yKey})`} />
          )}
          {groupKeys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        </BarChart>
      );

    case "line":
      return (
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey={widget.xAxis} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {groupKeys.length > 0 ? (
            groupKeys.map((key) => (
              <Line key={key} type="monotone" dataKey={sanitizeKey(key)} stroke={`var(--color-${sanitizeKey(key)})`} dot={false} />
            ))
          ) : (
            <Line type="monotone" dataKey={yKey} stroke={`var(--color-${yKey})`} dot={false} />
          )}
          {groupKeys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        </LineChart>
      );

    case "area":
      return (
        <AreaChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey={widget.xAxis} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {groupKeys.length > 0 ? (
            groupKeys.map((key) => (
              <Area key={key} type="monotone" dataKey={sanitizeKey(key)} fill={`var(--color-${sanitizeKey(key)})`} stroke={`var(--color-${sanitizeKey(key)})`} fillOpacity={0.3} />
            ))
          ) : (
            <Area type="monotone" dataKey={yKey} fill={`var(--color-${yKey})`} stroke={`var(--color-${yKey})`} fillOpacity={0.3} />
          )}
          {groupKeys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        </AreaChart>
      );

    case "pie":
      return (
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
            {data.map((entry, i) => (
              <Cell key={i} fill={`var(--color-${sanitizeKey(String(entry.name))})`} />
            ))}
          </Pie>
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
        </PieChart>
      );

    case "scatter":
      return (
        <ScatterChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
          <XAxis dataKey={widget.xAxis} tick={{ fontSize: 11 }} name={widget.xAxis} />
          <YAxis dataKey={yKey} tick={{ fontSize: 11 }} name={yKey} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Scatter data={data} fill={`var(--color-${yKey})`} />
        </ScatterChart>
      );
  }
}
