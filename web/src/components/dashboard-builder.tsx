"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Mountain,
  PieChart as PieChartIcon,
  Crosshair,
  Loader2,
  Columns2,
  Columns3,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChartWidget, isNumeric, isCategorical } from "@/components/chart-widget";
import { fetchJob, loadJobDiscovery } from "@/lib/api";
import {
  loadDashboard,
  saveDashboard,
  type ChartType,
  type ChartWidget as ChartWidgetType,
  type DashboardColumns,
} from "@/lib/dashboard-store";
import type { OutputInfo } from "@/lib/types";

interface DashboardBuilderProps {
  jobId: string;
}

export interface FieldSchema {
  name: string;
  type: string;
  iri: string;
}

interface ChartTypeOption {
  value: ChartType;
  label: string;
  icon: LucideIcon;
}

const ALL_CHART_TYPES: ChartTypeOption[] = [
  { value: "bar", label: "Bar", icon: BarChart3 },
  { value: "line", label: "Line", icon: TrendingUp },
  { value: "area", label: "Area", icon: Mountain },
  { value: "pie", label: "Pie", icon: PieChartIcon },
  { value: "scatter", label: "Scatter", icon: Crosshair },
];

function buildSchema(outputs: OutputInfo[]): FieldSchema[] {
  const seen = new Set<string>();
  const fields: FieldSchema[] = [];
  for (const o of outputs) {
    const types = o.field_types ?? {};
    const uris = o.field_uris ?? {};
    for (const name of o.fields) {
      const iri = uris[name];
      if (!iri || seen.has(name)) continue;
      seen.add(name);
      fields.push({
        name,
        type: types[name] ?? "String",
        iri,
      });
    }
  }
  return fields;
}

export function DashboardBuilder({ jobId }: DashboardBuilderProps) {
  const { data: job } = useSWR(`job-${jobId}`, () => fetchJob(jobId));
  const [graphReady, setGraphReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<ChartWidgetType[]>([]);
  const [columns, setColumns] = useState<DashboardColumns>(2);

  useEffect(() => {
    const layout = loadDashboard(jobId);
    setWidgets(layout.widgets);
    setColumns(layout.columns);
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadJobDiscovery(jobId)
      .then(() => { if (!cancelled) setGraphReady(true); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load data");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [jobId]);

  const schema = useMemo(() => {
    if (!job?.outputs) return [];
    return buildSchema(job.outputs);
  }, [job?.outputs]);

  const availableChartTypes = useMemo(() => {
    const numericCount = schema.filter((f) => isNumeric(f.type)).length;
    const categoricalCount = schema.filter((f) => isCategorical(f.type)).length;

    return ALL_CHART_TYPES.filter((t) => {
      if (t.value === "scatter") return numericCount >= 2;
      if (t.value === "pie") return categoricalCount > 0;
      return schema.length > 0;
    });
  }, [schema]);

  function persist(updated: ChartWidgetType[], cols: DashboardColumns = columns) {
    setWidgets(updated);
    saveDashboard(jobId, { widgets: updated, columns: cols });
  }

  function handleColumnsChange(value: string) {
    if (!value) return;
    const cols = Number(value) as DashboardColumns;
    setColumns(cols);
    saveDashboard(jobId, { widgets, columns: cols });
  }

  function addChart(type: ChartType) {
    const id = crypto.randomUUID();
    const categoricalFields = schema.filter((f) => isCategorical(f.type));
    const numericFields = schema.filter((f) => isNumeric(f.type));

    let xAxis = "";
    let yAxis: string | undefined;

    switch (type) {
      case "bar":
      case "line":
      case "area":
        xAxis = categoricalFields[0]?.name ?? schema[0]?.name ?? "";
        yAxis = numericFields[0]?.name;
        break;
      case "pie":
        xAxis = categoricalFields[0]?.name ?? "";
        break;
      case "scatter":
        xAxis = numericFields[0]?.name ?? "";
        yAxis = numericFields[1]?.name;
        break;
    }

    persist([
      ...widgets,
      { id, type, title: `Chart ${widgets.length + 1}`, xAxis, yAxis },
    ]);
  }

  function updateWidget(id: string, updated: ChartWidgetType) {
    persist(widgets.map((w) => (w.id === id ? updated : w)));
  }

  function removeWidget(id: string) {
    persist(widgets.filter((w) => w.id !== id));
  }

  const summaryText = useMemo(() => {
    if (schema.length === 0) return "";
    const numericCount = schema.filter((f) => isNumeric(f.type)).length;
    return `${schema.length} fields (${numericCount} numeric, ${schema.length - numericCount} categorical)`;
  }, [schema]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin mr-2" />
        Loading output data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {error}
      </div>
    );
  }

  if (!graphReady || schema.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No schema available for charting.
      </div>
    );
  }

  const gridColsClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";

  return (
    <div className="space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={String(columns)}
          onValueChange={handleColumnsChange}
        >
          <ToggleGroupItem value="1" aria-label="1 column">
            <Square size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="2" aria-label="2 columns">
            <Columns2 size={14} />
          </ToggleGroupItem>
          <ToggleGroupItem value="3" aria-label="3 columns">
            <Columns3 size={14} />
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="flex-1 text-right text-xs text-muted-foreground">
          {summaryText}
        </span>
      </div>

      <div className={`grid gap-4 ${gridColsClass}`}>
        {widgets.map((w) => (
          <ChartWidget
            key={w.id}
            widget={w}
            jobId={jobId}
            schema={schema}
            onChange={(updated) => updateWidget(w.id, updated)}
            onRemove={() => removeWidget(w.id)}
          />
        ))}

        <Card
          className={`border-dashed shadow-none min-h-[280px] flex items-center justify-center ${
            widgets.length === 0 ? "col-span-full" : ""
          }`}
        >
          <CardContent className="flex flex-col items-center gap-4 py-6">
            <p className="text-sm text-muted-foreground font-medium">Add a chart</p>
            <div className="flex flex-wrap gap-3 justify-center">
              {availableChartTypes.map((t) => (
                <Button
                  key={t.value}
                  variant="outline"
                  onClick={() => addChart(t.value)}
                  className="flex flex-col items-center gap-1.5 h-auto w-20 px-4 py-3 text-muted-foreground"
                >
                  <t.icon size={20} />
                  <span className="text-xs">{t.label}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
