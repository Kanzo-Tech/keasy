"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, MessageCircle, Settings2, ShieldCheck } from "lucide-react";
import { Query, literal, sql } from "@uwdata/mosaic-sql";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { type Selection, clausePoints } from "@uwdata/mosaic-core";
import { column } from "@uwdata/mosaic-sql";
import { useCoordinator, useCoordinatorQuery } from "./use-discovery-store";
import { DiscoveryAsk } from "./discovery-ask";
import { RuleBuilder } from "./rule-builder";
import type { GraphSchema } from "@/lib/graph-schema";
import type { GraphConfigInterface } from "@cosmos.gl/graph";

// Stable source identities for crossfilter clauses
const CHAT_SOURCE = { reset: () => {} };

// ── Types ────────────────────────────────────────────────────────────────

interface Props {
  jobId: string;
  schema: GraphSchema;
  selectedVertex: { id: string; type: string; label: string } | null;
  graphConfig: GraphConfigInterface;
  onConfigChange: (patch: Partial<GraphConfigInterface>) => void;
  selection: Selection;
}

// ── Default simulation params ────────────────────────────────────────────

const PARAM_DEFS = [
  { key: "simulationRepulsion", label: "Repulsion", min: 0, max: 2, step: 0.05 },
  { key: "simulationFriction", label: "Friction", min: 0, max: 1, step: 0.05 },
  { key: "simulationGravity", label: "Gravity", min: 0, max: 1, step: 0.05 },
  { key: "simulationDecay", label: "Decay", min: 100, max: 5000, step: 100 },
  { key: "simulationLinkSpring", label: "Link spring", min: 0, max: 1, step: 0.05 },
  { key: "simulationLinkDistance", label: "Link distance", min: 1, max: 100, step: 1 },
  { key: "pointSizeScale", label: "Point size", min: 0.5, max: 5, step: 0.1 },
] as const;

// ── Schema builder (lazy — only when Ask tab opened) ─────────────────────

async function buildDuckDBSchema(
  coordinator: { query: (q: string | import("@uwdata/mosaic-sql").Query | import("@uwdata/mosaic-sql").DescribeQuery, opts: { type: "json" }) => Promise<unknown> },
  schema: GraphSchema,
): Promise<string> {
  const parts = await Promise.all(
    schema.types.map(async (t) => {
      let ddl = "";
      try {
        const describeQ = Query.describe(Query.from(t.name));
        const result = await coordinator.query(describeQ, { type: "json" });
        const cols = (result as Record<string, unknown>[]) ?? [];
        ddl = `CREATE TABLE "${t.name}" (\n${cols.map((c) => `  "${c.column_name}" ${c.column_type}`).join(",\n")}\n);`;
      } catch {
        ddl = `-- Table: ${t.name} (${t.entityCount} entities)`;
      }
      let sampleStr = "";
      try {
        const sampleQ = Query.from(t.name).select("*").limit(3);
        const result = await coordinator.query(sampleQ, { type: "json" });
        const rows = (result as Record<string, unknown>[]) ?? [];
        if (rows.length > 0) {
          sampleStr = `\n-- Sample rows (${t.entityCount} total):\n${JSON.stringify(rows, null, 2)}`;
        }
      } catch { /* ignore */ }
      return ddl + sampleStr;
    }),
  );
  const edges = schema.edges.map(
    (e) => `-- Relationship: ${e.sourceType} --[${e.name}]--> ${e.targetType} (${e.count} edges)`,
  );
  return [...parts, ...edges].join("\n\n");
}

// ── Component ────────────────────────────────────────────────────────────

export function DiscoverySidebar({ jobId, schema, selectedVertex, graphConfig, onConfigChange, selection }: Props) {
  const coordinator = useCoordinator();
  const [activeTab, setActiveTab] = useState("info");

  // ── "Show on graph" crossfilter bridge ───────────────────────────────
  const handleShowOnGraph = useCallback(async (sqlStr: string) => {
    if (!coordinator) return;
    try {
      const result = await coordinator.query(sqlStr, { type: "json" });
      const rows = (result as { _id?: number }[]) ?? [];
      const ids = rows.map((r) => r._id).filter((id): id is number => id != null);
      if (ids.length > 0) {
        selection.update(
          clausePoints([column("_id")], ids.map((id) => [id]), { source: CHAT_SOURCE }),
        );
      }
    } catch { /* query failed — ignore silently */ }
  }, [coordinator, selection]);

  // ── Node properties (on-demand) ──────────────────────────────────────
  const propertiesQuery = useMemo(() => {
    if (!selectedVertex) return "";
    return Query.from(selectedVertex.type)
      .select("*")
      .where(sql`"subject" = ${literal(selectedVertex.id)}`)
      .limit(1)
      .toString();
  }, [selectedVertex]);

  const { data: propertiesResult } = useCoordinatorQuery<Record<string, unknown>>({
    query: propertiesQuery,
    enabled: !!propertiesQuery,
  });

  const properties = useMemo(() => {
    if (!propertiesResult || propertiesResult.length === 0 || !selectedVertex) return [];
    const row = propertiesResult[0];
    const fields = schema.fieldsOf(selectedVertex.type);
    return Object.entries(row)
      .filter(([key, val]) => key !== "_id" && key !== "subject" && val != null && val !== "")
      .map(([key, val]) => {
        const field = fields.find((f) => f.name === key);
        return { predicate: key, value: String(val), role: field?.role, datatype: field?.type };
      });
  }, [propertiesResult, selectedVertex, schema]);

  // ── Lazy DuckDB schema for Ask tab ───────────────────────────────────
  const [duckSchema, setDuckSchema] = useState("");
  const schemaBuiltRef = useRef(false);

  useEffect(() => {
    if (activeTab !== "ask" || schemaBuiltRef.current || !coordinator) return;
    schemaBuiltRef.current = true;
    buildDuckDBSchema(coordinator, schema).then(setDuckSchema).catch(() => {});
  }, [activeTab, coordinator, schema]);

  // Auto-switch to info when a node is selected
  useEffect(() => {
    if (selectedVertex) setActiveTab("info");
  }, [selectedVertex]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
      <TabsList className="w-full justify-start rounded-none border-b h-9 px-1 shrink-0">
        <TabsTrigger value="info" className="text-xs gap-1"><Info size={12} />Info</TabsTrigger>
        <TabsTrigger value="ask" className="text-xs gap-1"><MessageCircle size={12} />Ask</TabsTrigger>
        <TabsTrigger value="rules" className="text-xs gap-1"><ShieldCheck size={12} />Rules</TabsTrigger>
        <TabsTrigger value="settings" className="text-xs gap-1"><Settings2 size={12} />Settings</TabsTrigger>
      </TabsList>

      {/* Info tab */}
      <TabsContent value="info" className="flex-1 min-h-0 m-0">
        <ScrollArea className="h-full p-3">
          {selectedVertex ? (
            <div className="space-y-3">
              <div>
                <p className="font-medium text-sm truncate">{selectedVertex.label}</p>
                <p className="text-xs text-muted-foreground break-all mt-0.5">{selectedVertex.id}</p>
                <Badge variant="outline" className="mt-1 text-[10px]">{selectedVertex.type}</Badge>
              </div>
              {properties.length > 0 ? (
                <dl className="space-y-2 text-sm">
                  {properties.map((p, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground font-medium">{p.predicate}</dt>
                      <dd className="break-all">{p.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-muted-foreground">Loading properties...</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Click a node to inspect</p>
          )}
        </ScrollArea>
      </TabsContent>

      {/* Ask tab */}
      <TabsContent value="ask" className="flex-1 min-h-0 m-0">
        <DiscoveryAsk jobId={jobId} schema={duckSchema} graphSchema={schema} onShowOnGraph={handleShowOnGraph} />
      </TabsContent>

      {/* Rules tab */}
      <TabsContent value="rules" className="flex-1 min-h-0 m-0">
        <RuleBuilder jobId={jobId} schema={schema} />
      </TabsContent>

      {/* Settings tab */}
      <TabsContent value="settings" className="flex-1 min-h-0 m-0">
        <ScrollArea className="h-full p-3">
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">Simulation</p>
            {PARAM_DEFS.map(({ key, label, min, max, step }) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{label}</Label>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {(graphConfig[key as keyof GraphConfigInterface] as number)?.toFixed(key === "simulationDecay" || key === "simulationLinkDistance" ? 0 : 2)}
                  </span>
                </div>
                <Slider
                  min={min}
                  max={max}
                  step={step}
                  value={[(graphConfig[key as keyof GraphConfigInterface] as number) ?? min]}
                  onValueChange={([v]) => onConfigChange({ [key]: v })}
                />
              </div>
            ))}

            <div className="pt-2 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Display</p>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Show links</Label>
                <Switch
                  checked={graphConfig.renderLinks !== false}
                  onCheckedChange={(v) => onConfigChange({ renderLinks: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Scale on zoom</Label>
                <Switch
                  checked={graphConfig.scalePointsOnZoom !== false}
                  onCheckedChange={(v) => onConfigChange({ scalePointsOnZoom: v })}
                />
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => onConfigChange({
                simulationRepulsion: 0.5,
                simulationFriction: 0.5,
                simulationGravity: 0.25,
                simulationDecay: 1000,
                simulationLinkSpring: 0.4,
                simulationLinkDistance: 20,
                pointSizeScale: 1.1,
                renderLinks: true,
                scalePointsOnZoom: true,
              })}
            >
              Reset defaults
            </Button>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
