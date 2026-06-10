"use client";

import { useCallback, useMemo, useRef } from "react";
import { CheckCircle2, Loader2, Play, Plus, ShieldCheck, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/layout/workspace-layout";
import type { GraphSchema } from "@/lib/graph-schema";
import type { Query } from "@uwdata/mosaic-sql";
import { useCoordinator } from "./use-discovery-store";
import { type Rule, type RuleResult, runRules } from "@/lib/rule-engine";
import { createRuleBuilderStore } from "./rule-builder-store";
import { EntitySelect, FieldSelect, OperatorSelect, ValueInput } from "./rule-row";

interface RuleBuilderProps { jobId: string; schema: GraphSchema }

export function RuleBuilder({ jobId, schema }: RuleBuilderProps) {
  const coordinator = useCoordinator();
  const storeRef = useRef<ReturnType<typeof createRuleBuilderStore>>(undefined);
  if (!storeRef.current) storeRef.current = createRuleBuilderStore(jobId);
  const useStore = storeRef.current;

  const rules = useStore((s) => s.rules);
  const results = useStore((s) => s.results);
  const running = useStore((s) => s.running);

  function addRule() {
    const t = schema.types[0];
    if (!t || t.fields.length === 0) return;
    useStore.getState().addRule(t.name, t.fields[0].name);
  }

  function updateRule(id: string, updated: Rule) { useStore.getState().updateRule(id, updated); }
  function removeRule(id: string) { useStore.getState().removeRule(id); }

  const handleRunAll = useCallback(async () => {
    if (rules.length === 0 || !coordinator) return;
    useStore.getState().setRunning(true);
    try {
      const exec = async (q: Query) => {
        const r = await coordinator.query(q, { type: "json" });
        return (r as unknown as Record<string, unknown>[]) ?? [];
      };
      useStore.getState().setResults(await runRules(rules, exec));
    } finally { useStore.getState().setRunning(false); }
  }, [rules, coordinator, useStore]);

  const resultMap = useMemo(() => new Map(results.map((r) => [r.rule.id, r])), [results]);
  const { passedCount, totalViolations } = useMemo(() => {
    const passed = results.filter((r) => r.passed).length;
    const violations = results.reduce((s, r) => s + (r.violationCount > 0 ? r.violationCount : 0), 0);
    return { passedCount: passed, totalViolations: violations };
  }, [results]);

  if (schema.types.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Rules" />
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">No schema.</div>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Rules" />
        <EmptyState icon={ShieldCheck} title="No rules" description="Add data quality rules to validate your dataset." action={<Button variant="outline" size="sm" onClick={addRule}><Plus size={14} className="mr-1" /> Add rule</Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-8 shrink-0 border-b flex items-center justify-between px-2 bg-card">
        <span className="text-xs font-medium text-muted-foreground">Rules</span>
        <div className="flex items-center gap-1">
          {results.length > 0 && (
            <Badge variant={passedCount === results.length ? "secondary" : "destructive"} className="text-[10px]">
              {passedCount}/{results.length}
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleRunAll} disabled={running || rules.length === 0}>
            {running ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
            Run
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1.5 space-y-1">
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              result={resultMap.get(rule.id)}
              schema={schema}
              conjunction={index === 0 ? "Where" : "And"}
              onUpdate={(u) => updateRule(rule.id, u)}
              onRemove={() => removeRule(rule.id)}
            />
          ))}
          <Button variant="link" size="sm" className="text-[10px] h-6 pl-12" onClick={addRule}>
            <Plus size={10} /> Add filter
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Rule Row (Notion-style) ──────────────────────────────────────────────

function RuleRow({ rule, result, schema, conjunction, onUpdate, onRemove }: {
  rule: Rule; result?: RuleResult; schema: GraphSchema; conjunction: string;
  onUpdate: (updated: Rule) => void; onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 h-7">
      {/* Conjunction — fixed width, left-aligned, muted */}
      <span className="w-11 shrink-0 text-xs text-muted-foreground/60 pl-1">{conjunction}</span>

      {/* Property (entity.field) */}
      <div className="shrink-0"><EntitySelect rule={rule} schema={schema} onChange={onUpdate} /></div>
      <div className="shrink-0"><FieldSelect rule={rule} schema={schema} onChange={onUpdate} /></div>

      {/* Operator */}
      <div className="shrink-0"><OperatorSelect rule={rule} schema={schema} onChange={onUpdate} /></div>

      {/* Value — takes remaining space */}
      <div className="flex-1 min-w-0"><ValueInput rule={rule} schema={schema} onChange={onUpdate} /></div>

      {/* Status icon */}
      {result && (
        <span className="shrink-0">
          {result.passed
            ? <CheckCircle2 size={12} className="text-green-500" />
            : <XCircle size={12} className="text-destructive" />}
        </span>
      )}

      {/* Delete */}
      <Button variant="ghost" size="icon" className="shrink-0 h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label="Remove rule">
        <X size={14} />
      </Button>
    </div>
  );
}
