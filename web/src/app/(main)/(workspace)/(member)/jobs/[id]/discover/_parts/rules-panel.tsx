"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CheckCircle2, Play, Plus, ShieldCheck, X, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Item,
  ItemActions,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  ScrollArea,
  Spinner,
} from "@kanzo-tech/ui";
import { useMosaic } from "@kanzo-tech/ui/analytics";
import type { GraphSchema } from "@/lib/graph-schema";
import { type Rule, type RuleResult, runRules } from "@/lib/rule-engine";
import { EntitySelect, FieldSelect, OperatorSelect, ValueInput } from "./rule-fields";

interface RulesState {
  rules: Rule[];
  results: RuleResult[];
  running: boolean;
}

/** Rules live in this browser only, per job; results and the run flag are not persisted. */
function createRulesStore(jobId: string) {
  return create<RulesState>()(
    persist((): RulesState => ({ rules: [], results: [], running: false }), {
      name: `keasy:rules:${jobId}`,
      partialize: (s) => ({ rules: s.rules }),
    }),
  );
}

export function RulesPanel({ jobId, schema }: { jobId: string; schema: GraphSchema }) {
  const { coordinator } = useMosaic();
  const [useRules] = useState(() => createRulesStore(jobId));
  const { rules, results, running } = useRules();

  const add = () => {
    const t = schema.types[0];
    if (!t?.fields[0]) return;
    const rule: Rule = { id: crypto.randomUUID(), fieldKey: t.fields[0].name, operator: "not_null", typeName: t.name };
    useRules.setState((s) => ({ rules: [...s.rules, rule] }));
  };
  const update = (id: string, updated: Rule) =>
    useRules.setState((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) }));
  const remove = (id: string) =>
    useRules.setState((s) => ({
      rules: s.rules.filter((r) => r.id !== id),
      results: s.results.filter((r) => r.rule.id !== id),
    }));

  const runAll = async () => {
    useRules.setState({ running: true });
    try {
      const results = await runRules(rules, async (q) =>
        (await coordinator.query(q, { type: "json" })) as unknown as Record<string, unknown>[],
      );
      useRules.setState({ results });
    } finally {
      useRules.setState({ running: false });
    }
  };

  const resultOf = useMemo(() => new Map(results.map((r) => [r.rule.id, r])), [results]);
  const passed = results.filter((r) => r.passed).length;

  if (rules.length === 0) {
    return (
      <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
        <ItemMedia className="text-muted-foreground" variant="icon">
          <ShieldCheck />
        </ItemMedia>
        <ItemTitle>No rules</ItemTitle>
        <ItemDescription>Add data quality rules to validate your dataset.</ItemDescription>
        <ItemActions>
          <Button disabled={schema.types.length === 0} onClick={add} size="sm" variant="outline">
            <Plus /> Add rule
          </Button>
        </ItemActions>
      </Item>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b px-2">
        {results.length > 0 && (
          <Badge variant={passed === results.length ? "success" : "destructive"}>
            {passed}/{results.length}
          </Badge>
        )}
        <Button disabled={running} onClick={runAll} size="sm" variant="ghost">
          {running ? <Spinner /> : <Play />}
          Run
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-1.5">
          {rules.map((rule, index) => {
            const result = resultOf.get(rule.id);
            return (
              <div className="group flex h-7 items-center gap-1" key={rule.id}>
                <span className="w-11 shrink-0 ps-1 text-muted-foreground text-xs">{index === 0 ? "Where" : "And"}</span>
                <EntitySelect onChange={(u) => update(rule.id, u)} rule={rule} schema={schema} />
                <FieldSelect onChange={(u) => update(rule.id, u)} rule={rule} schema={schema} />
                <OperatorSelect onChange={(u) => update(rule.id, u)} rule={rule} />
                <div className="min-w-0 flex-1">
                  <ValueInput onChange={(u) => update(rule.id, u)} rule={rule} />
                </div>
                {result &&
                  (result.passed ? (
                    <CheckCircle2 aria-label="Passed" className="size-3 shrink-0 text-success" />
                  ) : (
                    <XCircle aria-label="Failed" className="size-3 shrink-0 text-destructive" />
                  ))}
                <Button
                  aria-label="Remove rule"
                  className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => remove(rule.id)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>
            );
          })}
          <Button className="ms-11" onClick={add} size="sm" variant="ghost">
            <Plus /> Add filter
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
