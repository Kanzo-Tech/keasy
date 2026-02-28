"use client";

import { type ReactNode, useMemo } from "react";
import { X, Loader2, Settings2 } from "lucide-react";
import useSWR from "swr";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { EditableText } from "@/components/ui/editable-text";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { chartJobData } from "@/lib/api";
import type {
  ChartWidget as ChartWidgetType,
  ChartType,
} from "@/lib/dashboard-store";
import type { FieldSchema } from "@/components/discovery/dashboard-builder";

interface RenderContext {
  widget: ChartWidgetType;
  data: Record<string, string | number>[];
  yKey: string;
  groupKeys: string[];
}

interface ChartRule {
  label: string;
  xAxis: "numeric" | "any";
  minNumeric: number;
  rawAxes: boolean;
  splitBy: boolean;
  defaultYField: boolean;
  render: (ctx: RenderContext) => ReactNode;
}

export function isNumeric(type: string): boolean {
  return type === "Int" || type === "Float";
}

export function isCategorical(type: string): boolean {
  return type === "String" || type === "Bool";
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

const CHART_MARGIN = { top: 5, right: 20, bottom: 5, left: 0 };

function renderSeries(
  yKey: string,
  groupKeys: string[],
  factory: (key: string, color: string) => ReactNode,
): ReactNode {
  if (groupKeys.length > 0) {
    return groupKeys.map((key) =>
      factory(sanitizeKey(key), `var(--color-${sanitizeKey(key)})`),
    );
  }
  return factory(yKey, `var(--color-${yKey})`);
}

function cartesian(
  Wrapper: React.ElementType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts series have required props we always provide via spread
  Series: any,
  seriesProps: (color: string) => Record<string, unknown>,
): ChartRule["render"] {
  return function CartesianRenderer({ widget, data, yKey, groupKeys }) {
    const legend = groupKeys.length > 1 && (
      <ChartLegend content={<ChartLegendContent />} />
    );
    return (
      <Wrapper data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey={widget.xAxis} tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {renderSeries(yKey, groupKeys, (key, color) => (
          <Series key={key} dataKey={key} {...seriesProps(color)} />
        ))}
        {legend}
      </Wrapper>
    );
  };
}

function renderPie({ data }: RenderContext): ReactNode {
  return (
    <PieChart>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        outerRadius={80}
        label
      >
        {data.map((entry, i) => (
          <Cell
            key={i}
            fill={`var(--color-${sanitizeKey(String(entry.name))})`}
          />
        ))}
      </Pie>
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
    </PieChart>
  );
}

function renderScatter({ widget, data, yKey }: RenderContext): ReactNode {
  return (
    <ScatterChart data={data} margin={CHART_MARGIN}>
      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
      <XAxis
        type="number"
        dataKey={widget.xAxis}
        tick={{ fontSize: 11 }}
        name={widget.xAxis}
      />
      <YAxis type="number" dataKey={yKey} tick={{ fontSize: 11 }} name={yKey} />
      <ChartTooltip content={<ChartTooltipContent />} />
      <Scatter data={data} fill={`var(--color-${yKey})`} />
    </ScatterChart>
  );
}

export const CHART_RULES: Record<ChartType, ChartRule> = {
  bar: {
    label: "Bar",
    xAxis: "any",
    minNumeric: 0,
    rawAxes: false,
    splitBy: true,
    defaultYField: true,
    render: cartesian(BarChart, Bar, (c) => ({ fill: c })),
  },
  line: {
    label: "Line",
    xAxis: "numeric",
    minNumeric: 1,
    rawAxes: false,
    splitBy: true,
    defaultYField: true,
    render: cartesian(LineChart, Line, (c) => ({
      type: "monotone",
      stroke: c,
      dot: false,
    })),
  },
  area: {
    label: "Area",
    xAxis: "numeric",
    minNumeric: 1,
    rawAxes: false,
    splitBy: true,
    defaultYField: true,
    render: cartesian(AreaChart, Area, (c) => ({
      type: "monotone",
      fill: c,
      stroke: c,
      fillOpacity: 0.3,
    })),
  },
  pie: {
    label: "Pie",
    xAxis: "any",
    minNumeric: 0,
    rawAxes: false,
    splitBy: false,
    defaultYField: false,
    render: renderPie,
  },
  scatter: {
    label: "Scatter",
    xAxis: "numeric",
    minNumeric: 2,
    rawAxes: true,
    splitBy: false,
    defaultYField: true,
    render: renderScatter,
  },
};

export function xColumnsForType(
  type: ChartType,
  schema: FieldSchema[],
): FieldSchema[] {
  return CHART_RULES[type].xAxis === "numeric"
    ? schema.filter((f) => isNumeric(f.type))
    : schema;
}

export function isChartAvailable(
  type: ChartType,
  schema: FieldSchema[],
): boolean {
  if (schema.length === 0) return false;
  const numericCount = schema.filter((f) => isNumeric(f.type)).length;
  return numericCount >= CHART_RULES[type].minNumeric;
}

export function defaultAxesForType(
  type: ChartType,
  schema: FieldSchema[],
): { xAxis: string; yAxis?: string } {
  const rule = CHART_RULES[type];
  const numeric = schema.filter((f) => isNumeric(f.type));
  const categorical = schema.filter((f) => isCategorical(f.type));

  const xAxis =
    rule.xAxis === "numeric"
      ? (numeric[0]?.name ?? "")
      : (categorical[0]?.name ?? schema[0]?.name ?? "");

  if (!rule.defaultYField) return { xAxis };

  const yAxis = numeric.find((f) => f.name !== xAxis)?.name;
  return { xAxis, yAxis };
}

const MEASURE_OPTIONS = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
];

const COLORS = [
  "var(--primary)",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#14b8a6",
];

interface ChartWidgetProps {
  widget: ChartWidgetType;
  jobId: string;
  schema: FieldSchema[];
  onChange: (updated: ChartWidgetType) => void;
  onRemove: () => void;
}

export function ChartWidget({
  widget,
  jobId,
  schema,
  onChange,
  onRemove,
}: ChartWidgetProps) {
  const rule = CHART_RULES[widget.type];

  const fieldMap = useMemo(() => {
    const m: Record<string, FieldSchema> = {};
    for (const f of schema) m[f.name] = f;
    return m;
  }, [schema]);

  const xColumns = useMemo(
    () => xColumnsForType(widget.type, schema),
    [schema, widget.type],
  );

  const yColumns = useMemo(
    () => schema.filter((f) => isNumeric(f.type)),
    [schema],
  );

  const groupByColumns = useMemo(
    () =>
      schema.filter((f) => isCategorical(f.type) && f.name !== widget.xAxis),
    [schema, widget.xAxis],
  );

  const measureType = rule.rawAxes
    ? "none"
    : !widget.yAxis
      ? "count"
      : widget.aggregation === "count"
        ? "sum"
        : (widget.aggregation ?? "sum");

  function handleMeasureChange(type: string) {
    if (type === "count") {
      onChange({ ...widget, yAxis: undefined, aggregation: "count" });
    } else {
      onChange({
        ...widget,
        yAxis: widget.yAxis ?? yColumns[0]?.name,
        aggregation: type,
      });
    }
  }

  const effectiveAggregation = useMemo(() => {
    if (rule.rawAxes) return "none";
    if (!widget.yAxis) return "count";
    if (widget.aggregation === "count") return "sum";
    return widget.aggregation ?? "sum";
  }, [rule.rawAxes, widget.yAxis, widget.aggregation]);

  const xField = fieldMap[widget.xAxis];
  const yField = widget.yAxis ? fieldMap[widget.yAxis] : undefined;
  const groupField = widget.groupBy ? fieldMap[widget.groupBy] : undefined;

  const chartSwrKey = xField
    ? `chart-${jobId}-${widget.xAxis}-${widget.yAxis ?? ""}-${widget.groupBy ?? ""}-${widget.type}-${effectiveAggregation}`
    : null;

  const { data: rawResult, isLoading: queryLoading } = useSWR(chartSwrKey, () =>
    chartJobData(jobId, {
      x_predicate: xField!.iri,
      y_predicate: yField?.iri,
      group_predicate: groupField?.iri,
      aggregation: effectiveAggregation,
    }),
  );

  const chartData = useMemo<Record<string, string | number>[]>(() => {
    if (!rawResult) return [];
    if (widget.groupBy && rawResult.rows.length > 0) {
      const groups = new Map<string, Map<string, number>>();
      for (const row of rawResult.rows) {
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
      return data;
    }
    if (widget.type === "pie") {
      return rawResult.rows.map((r) => ({
        name: String(r.x ?? ""),
        value: Number(r.value ?? r.count ?? 0),
      }));
    }
    return rawResult.rows.map((r) => {
      const point: Record<string, string | number> = {
        [widget.xAxis]: r.x ?? "",
      };
      if (widget.yAxis) {
        point[sanitizeKey(widget.yAxis)] = r.y ?? r.value ?? "";
      } else if (r.value != null) {
        point.value = Number(r.value);
      }
      return point;
    });
  }, [rawResult, widget.groupBy, widget.type, widget.xAxis, widget.yAxis]);

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
        config[sanitizeKey(String(d.name))] = {
          label: String(d.name),
          color: COLORS[i % COLORS.length],
        };
      });
    } else if (groupKeys.length > 0) {
      groupKeys.forEach((key, i) => {
        config[sanitizeKey(key)] = {
          label: key,
          color: COLORS[i % COLORS.length],
        };
      });
    } else {
      const key = widget.yAxis ?? "value";
      config[sanitizeKey(key)] = { label: key, color: COLORS[0] };
    }
    return config;
  }, [widget.type, widget.yAxis, groupKeys, chartData]);

  const configParts: string[] = [];
  if (rule.rawAxes) {
    if (widget.xAxis) configParts.push(`X: ${widget.xAxis}`);
    if (widget.yAxis) configParts.push(`Y: ${widget.yAxis}`);
  } else {
    if (widget.xAxis) configParts.push(`Category: ${widget.xAxis}`);
    if (!widget.yAxis) {
      configParts.push("Measure: Count");
    } else {
      const label = effectiveAggregation === "avg" ? "Avg" : "Sum";
      configParts.push(`Measure: ${label} of ${widget.yAxis}`);
    }
    if (widget.groupBy) configParts.push(`Split by: ${widget.groupBy}`);
  }

  return (
    <Card className="py-4 gap-3 shadow-none">
      <CardHeader className="px-4 py-0">
        <CardTitle className="flex items-center gap-2">
          <EditableText
            className="text-sm font-medium flex-1 min-w-0"
            value={widget.title}
            onSave={(title) => onChange({ ...widget, title })}
            placeholder="Chart title..."
          />
          <Badge variant="secondary">{rule.label}</Badge>
        </CardTitle>
        <CardAction className="flex items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Settings2 size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              {rule.rawAxes ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">X Axis</Label>
                    <Select
                      value={widget.xAxis || ""}
                      onValueChange={(v) => onChange({ ...widget, xAxis: v })}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        {xColumns.map((f) => (
                          <SelectItem key={f.name} value={f.name}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              <span className="text-[10px] text-muted-foreground">
                                {f.type}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Y Axis</Label>
                    <Select
                      value={widget.yAxis ?? ""}
                      onValueChange={(v) => onChange({ ...widget, yAxis: v })}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        {yColumns.map((f) => (
                          <SelectItem key={f.name} value={f.name}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              <span className="text-[10px] text-muted-foreground">
                                {f.type}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">Category</Label>
                    <Select
                      value={widget.xAxis || ""}
                      onValueChange={(v) => onChange({ ...widget, xAxis: v })}
                    >
                      <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        {xColumns.map((f) => (
                          <SelectItem key={f.name} value={f.name}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              <span className="text-[10px] text-muted-foreground">
                                {f.type}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Measure</Label>
                    <div className="flex gap-2">
                      <Select
                        value={measureType}
                        onValueChange={handleMeasureChange}
                      >
                        <SelectTrigger className="w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEASURE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {measureType !== "count" && (
                        <Select
                          value={widget.yAxis ?? ""}
                          onValueChange={(v) =>
                            onChange({ ...widget, yAxis: v })
                          }
                        >
                          <SelectTrigger className="flex-1 text-xs">
                            <SelectValue placeholder="Field..." />
                          </SelectTrigger>
                          <SelectContent>
                            {yColumns.map((f) => (
                              <SelectItem key={f.name} value={f.name}>
                                {f.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  {rule.splitBy && (
                    <div className="space-y-2">
                      <Label className="text-xs">Split by</Label>
                      <Select
                        value={widget.groupBy ?? "__none__"}
                        onValueChange={(v) =>
                          onChange({
                            ...widget,
                            groupBy: v === "__none__" ? undefined : v,
                          })
                        }
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
                                <span className="text-[10px] text-muted-foreground">
                                  {f.type}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onRemove}
          >
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
            {
              rule.render({
                widget,
                data: chartData,
                yKey,
                groupKeys,
              }) as React.ReactElement
            }
          </ChartContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">
            {rule.rawAxes
              ? "Select X and Y axes"
              : "Select a category to render chart"}
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
