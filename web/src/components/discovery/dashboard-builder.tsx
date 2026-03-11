"use client";

import { useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  Mountain,
  PieChart as PieChartIcon,
  Crosshair,
  Columns2,
  Columns3,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartWidget,
  CHART_RULES,
  isNumeric,
  isChartAvailable,
  defaultAxesForType,
} from "@/components/discovery/chart-widget";
import { api } from "@/lib/api";
import {
  loadDashboard,
  saveDashboard,
  type ChartType,
  type ChartWidget as ChartWidgetType,
  type DashboardColumns,
} from "@/lib/dashboard-store";
import type { PipelineOutput } from "@/lib/types";

interface DashboardBuilderProps {
  jobId: string;
}

export interface FieldSchema {
  name: string;
  type: string;
  iri: string;
}

const CHART_TYPE_ICONS: Record<ChartType, LucideIcon> = {
  bar: BarChart3,
  line: TrendingUp,
  area: Mountain,
  pie: PieChartIcon,
  scatter: Crosshair,
};

const ALL_CHART_TYPES = (Object.keys(CHART_RULES) as ChartType[]).map((value) => ({
  value,
  icon: CHART_TYPE_ICONS[value],
}));

function buildSchema(outputs: PipelineOutput[]): FieldSchema[] {
  const seen = new Set<string>();
  const fields: FieldSchema[] = [];
  for (const o of outputs) {
    for (const field of o.fields) {
      if (!field.uri || seen.has(field.name)) continue;
      seen.add(field.name);
      fields.push({
        name: field.name,
        type: field.type,
        iri: field.uri,
      });
    }
  }
  return fields;
}

export function DashboardBuilder({ jobId }: DashboardBuilderProps) {
  const queryClient = useQueryClient();
  const { data: job } = useQuery({ queryKey: queryKeys.jobs.detail(jobId), queryFn: () => api.jobs.get(jobId) });

  const { data: savedLayout, isLoading: layoutLoading } = useQuery({
    queryKey: queryKeys.dashboard(jobId),
    queryFn: () => loadDashboard(jobId),
  });

  const effectiveWidgets = savedLayout?.widgets ?? [];
  const effectiveColumns = savedLayout?.columns ?? 2;

  const { data: discovery, isLoading, error } = useQuery({
    queryKey: queryKeys.discovery.db(jobId),
    queryFn: () => api.discovery.load(jobId),
  });
  const showSkeleton = useDelayedLoading(isLoading || layoutLoading);

  const graphReady = discovery != null;

  const pipelineOutputs = job?.pipeline?.outputs;
  const schema = useMemo(() => {
    if (!pipelineOutputs) return [];
    return buildSchema(pipelineOutputs);
  }, [pipelineOutputs]);

  const availableChartTypes = useMemo(
    () => ALL_CHART_TYPES.filter((t) => isChartAvailable(t.value, schema)),
    [schema],
  );

  function persist(updated: ChartWidgetType[], cols: DashboardColumns = effectiveColumns) {
    const layout = { widgets: updated, columns: cols };
    queryClient.setQueryData(queryKeys.dashboard(jobId), layout);
    saveDashboard(jobId, layout);
  }

  function handleColumnsChange(value: string) {
    if (!value) return;
    persist(effectiveWidgets, Number(value) as DashboardColumns);
  }

  function addChart(type: ChartType) {
    const { xAxis, yAxis } = defaultAxesForType(type, schema);
    persist([
      ...effectiveWidgets,
      { id: crypto.randomUUID(), type, title: `Chart ${effectiveWidgets.length + 1}`, xAxis, yAxis },
    ]);
  }

  function updateWidget(id: string, updated: ChartWidgetType) {
    persist(effectiveWidgets.map((w) => (w.id === id ? updated : w)));
  }

  function removeWidget(id: string) {
    persist(effectiveWidgets.filter((w) => w.id !== id));
  }

  const summaryText = useMemo(() => {
    if (schema.length === 0) return "";
    const numericCount = schema.filter((f) => isNumeric(f.type)).length;
    return `${schema.length} fields (${numericCount} numeric, ${schema.length - numericCount} categorical)`;
  }, [schema]);

  if (isLoading || layoutLoading) {
    return showSkeleton ? (
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton loading>
              <ToggleGroup type="single" variant="outline" size="sm" value="2">
                <ToggleGroupItem value="1" aria-label="1 column"><Square size={14} /></ToggleGroupItem>
                <ToggleGroupItem value="2" aria-label="2 columns"><Columns2 size={14} /></ToggleGroupItem>
                <ToggleGroupItem value="3" aria-label="3 columns"><Columns3 size={14} /></ToggleGroupItem>
              </ToggleGroup>
            </Skeleton>
            <span className="flex-1" />
            <Skeleton loading><span className="text-xs text-muted-foreground">0 fields (0 numeric, 0 categorical)</span></Skeleton>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="min-h-[340px] rounded-lg" />
            ))}
          </div>
        </div>
      </ScrollArea>
    ) : null;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {error?.message}
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
    effectiveColumns === 1
      ? "grid-cols-1"
      : effectiveColumns === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(effectiveColumns)}
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

        <div className={`grid gap-4 auto-rows-[minmax(340px,auto)] ${gridColsClass}`}>
          {effectiveWidgets.map((w) => (
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
            className={`border-dashed shadow-none min-h-[340px] flex items-center justify-center ${
              effectiveWidgets.length === 0 ? "col-span-full" : ""
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
                    <span className="text-xs">{CHART_RULES[t.value].label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ScrollArea>
  );
}
