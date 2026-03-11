"use client";

import { type ReactNode, useMemo } from "react";
import { X, Loader2, Settings2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { api } from "@/lib/api";
import type {
  ChartWidget as ChartWidgetType,
  ChartType,
} from "@/lib/dashboard-store";
import {
  type FieldSchema,
  type AnalyticalSchema,
  fieldKey,
} from "@/lib/analytical-schema";

interface RenderContext {
  widget: ChartWidgetType;
  data: Record<string, string | number>[];
  yKey: string;
  groupKeys: string[];
  xDataKey: string;
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

const DEFAULT_TOP_N = 20;
const DEFAULT_GROUP_TOP_N = 10;
const NONE_VALUE = "__none__" as const;

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
  return function CartesianRenderer({ data, yKey, groupKeys, xDataKey }) {
    const legend = groupKeys.length > 1 && (
      <ChartLegend content={<ChartLegendContent />} />
    );
    return (
      <Wrapper data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
        <XAxis dataKey={xDataKey} tick={{ fontSize: 11 }} />
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

function renderScatter({ data, yKey, xDataKey }: RenderContext): ReactNode {
  return (
    <ScatterChart data={data} margin={CHART_MARGIN}>
      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
      <XAxis
        type="number"
        dataKey={xDataKey}
        tick={{ fontSize: 11 }}
        name={xDataKey}
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
    ? schema.filter((f) => f.role === "measure")
    : schema.filter((f) => f.role !== "identifier");
}

export function isChartAvailable(
  type: ChartType,
  schema: FieldSchema[],
): boolean {
  if (schema.length === 0) return false;
  const measureCount = schema.filter((f) => f.role === "measure").length;
  return measureCount >= CHART_RULES[type].minNumeric;
}

export function defaultAxesForType(
  type: ChartType,
  fields: FieldSchema[],
  anchor: string,
): { xAxis: string; yAxis?: string } {
  const rule = CHART_RULES[type];
  const measures = fields.filter((f) => f.role === "measure");
  const dimensions = fields.filter((f) => f.role === "dimension");

  const xRaw =
    rule.xAxis === "numeric"
      ? measures[0]
      : (dimensions[0] ?? fields.filter((f) => f.role !== "identifier")[0]);

  const xAxis = xRaw ? `${anchor}::${xRaw.name}` : "";
  if (!rule.defaultYField) return { xAxis };

  const yRaw = measures.find((f) => f !== xRaw);
  const yAxis = yRaw ? `${anchor}::${yRaw.name}` : undefined;
  return { xAxis, yAxis };
}

function FieldLabel({ field }: { field: FieldSchema }) {
  return (
    <span className="flex items-center gap-2">
      {field.name}
      <span className={`text-[10px] ${
        field.role === "identifier" ? "text-amber-500" : "text-muted-foreground"
      }`}>
        {field.distinct != null ? `${field.distinct} vals` : field.type}
      </span>
    </span>
  );
}

function GroupedFieldItems({
  fields,
  anchor,
  schema,
}: {
  fields: FieldSchema[];
  anchor: string;
  schema: AnalyticalSchema;
}) {
  const grouped = Map.groupBy(fields, (f) => f.sourceType);
  const entries = [...grouped.entries()];

  if (entries.length <= 1) {
    return fields.map((f) => (
      <SelectItem key={fieldKey(f)} value={fieldKey(f)}>
        <FieldLabel field={f} />
      </SelectItem>
    ));
  }

  return entries.map(([type, typeFields]) => {
    const edge = schema.edgeBetween(anchor, type);
    const label = type === anchor ? "Direct" : `via ${edge?.predicateName ?? type}`;
    return (
      <SelectGroup key={type}>
        <SelectLabel className="text-[10px] text-muted-foreground">{label}</SelectLabel>
        {typeFields.map((f) => (
          <SelectItem key={fieldKey(f)} value={fieldKey(f)}>
            <FieldLabel field={f} />
          </SelectItem>
        ))}
      </SelectGroup>
    );
  });
}

const MEASURE_OPTIONS: { value: "count" | "sum" | "avg"; label: string }[] = [
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
  schema: AnalyticalSchema;
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
  const anchor = widget.entityType ?? schema.types[0]?.typeName ?? "";
  const activeET = schema.types.find((et) => et.typeName === anchor) ?? schema.types[0];

  const reachable = useMemo(
    () => schema.reachableFrom(anchor),
    [schema, anchor],
  );

  function handleEntityTypeChange(typeName: string) {
    const fields = schema.reachableFrom(typeName);
    const { xAxis, yAxis } = defaultAxesForType(widget.type, fields, typeName);
    onChange({ ...widget, entityType: typeName, xAxis, yAxis, groupBy: undefined });
  }

  const rule = CHART_RULES[widget.type];

  const xColumns = useMemo(
    () => xColumnsForType(widget.type, reachable),
    [reachable, widget.type],
  );

  const yColumns = useMemo(
    () => reachable.filter((f) => f.role === "measure"),
    [reachable],
  );

  const xField = schema.fieldByKey(widget.xAxis);
  const yField = widget.yAxis ? schema.fieldByKey(widget.yAxis) : undefined;
  const groupField = widget.groupBy ? schema.fieldByKey(widget.groupBy) : undefined;

  const groupByColumns = useMemo(
    () => schema.splitCandidates(anchor, widget.xAxis),
    [schema, anchor, widget.xAxis],
  );

  function handleMeasureChange(type: "count" | "sum" | "avg") {
    if (type === "count") {
      onChange({ ...widget, yAxis: undefined, aggregation: "count" });
    } else {
      onChange({
        ...widget,
        yAxis: widget.yAxis ?? (yColumns[0] ? fieldKey(yColumns[0]) : undefined),
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

  const xRef = useMemo(
    () => xField ? schema.resolve(anchor, xField) : undefined,
    [xField, schema, anchor],
  );
  const yRef = useMemo(
    () => yField ? schema.resolve(anchor, yField) : undefined,
    [yField, schema, anchor],
  );
  const groupRef = useMemo(
    () => groupField ? schema.resolve(anchor, groupField) : undefined,
    [groupField, schema, anchor],
  );

  const { data: rawResult, isLoading: queryLoading } = useQuery({
    queryKey: queryKeys.discovery.chart(jobId, widget.xAxis, widget.yAxis ?? "", widget.groupBy ?? "", widget.type, effectiveAggregation, activeET?.rdfType ?? ""),
    queryFn: () =>
      api.discovery.chart(jobId, {
        x: xRef!,
        y: yRef,
        group: groupRef,
        aggregation: effectiveAggregation,
        top_n: xField!.role === "dimension" ? DEFAULT_TOP_N : undefined,
        group_top_n: groupField ? DEFAULT_GROUP_TOP_N : undefined,
        rdf_type: activeET?.rdfType,
      }),
    enabled: !!xField && !!xRef,
  });

  const xDisplayName = xField?.name ?? widget.xAxis;
  const yDisplayName = yField?.name ?? widget.yAxis ?? "value";

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
        const point: Record<string, string | number> = { [xDisplayName]: x };
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
        [xDisplayName]: r.x ?? "",
      };
      if (widget.yAxis) {
        point[sanitizeKey(yDisplayName)] = r.y ?? r.value ?? "";
      } else if (r.value != null) {
        point.value = Number(r.value);
      }
      return point;
    });
  }, [rawResult, widget.groupBy, widget.yAxis, widget.type, xDisplayName, yDisplayName]);

  const groupKeys = useMemo(() => {
    if (!widget.groupBy || chartData.length === 0) return [];
    const keys = new Set<string>();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== xDisplayName) keys.add(k);
      }
    }
    return [...keys];
  }, [chartData, widget.groupBy, xDisplayName]);

  const yKey = widget.yAxis
    ? sanitizeKey(yDisplayName)
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
      const key = yDisplayName;
      config[sanitizeKey(key)] = { label: key, color: COLORS[0] };
    }
    return config;
  }, [widget.type, yDisplayName, groupKeys, chartData]);

  const groupDisplayName = groupField?.name;
  const configParts: string[] = [];
  if (rule.rawAxes) {
    if (xField) configParts.push(`X: ${xDisplayName}`);
    if (yField) configParts.push(`Y: ${yDisplayName}`);
  } else {
    if (xField) configParts.push(`Category: ${xDisplayName}`);
    if (!widget.yAxis) {
      configParts.push("Measure: Count");
    } else {
      const label = effectiveAggregation === "avg" ? "Avg" : "Sum";
      configParts.push(`Measure: ${label} of ${yDisplayName}`);
    }
    if (groupDisplayName) configParts.push(`Split by: ${groupDisplayName}`);
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
              {schema.types.length > 1 && (
                <div className="space-y-2">
                  <Label className="text-xs">Anchor type</Label>
                  <Select
                    value={activeET?.typeName ?? ""}
                    onValueChange={handleEntityTypeChange}
                  >
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {schema.types.map((et) => (
                        <SelectItem key={et.typeName} value={et.typeName}>
                          <span className="flex items-center gap-2">
                            {et.typeName}
                            <span className="text-[10px] text-muted-foreground">
                              {et.fields.length} fields
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                        <GroupedFieldItems fields={xColumns} anchor={anchor} schema={schema} />
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
                        <GroupedFieldItems fields={yColumns} anchor={anchor} schema={schema} />
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
                        <GroupedFieldItems fields={xColumns} anchor={anchor} schema={schema} />
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Measure</Label>
                    <div className="flex gap-2">
                      <Select
                        value={effectiveAggregation}
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
                      {effectiveAggregation !== "count" && (
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
                            <GroupedFieldItems fields={yColumns} anchor={anchor} schema={schema} />
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  {rule.splitBy && (
                    <div className="space-y-2">
                      <Label className="text-xs">Split by</Label>
                      <Select
                        value={widget.groupBy ?? NONE_VALUE}
                        onValueChange={(v) =>
                          onChange({
                            ...widget,
                            groupBy: v === NONE_VALUE ? undefined : v,
                          })
                        }
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue placeholder="Select column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>(none)</SelectItem>
                          <GroupedFieldItems fields={groupByColumns} anchor={anchor} schema={schema} />
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
                xDataKey: xDisplayName,
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
