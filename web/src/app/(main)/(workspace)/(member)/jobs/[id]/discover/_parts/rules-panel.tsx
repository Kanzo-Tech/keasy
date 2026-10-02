"use client";

import { useDeferredValue, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { XIcon } from "lucide-react";
import { Button, cn, ScrollArea, Skeleton } from "@kanzo-tech/ui";
import { numbers } from "@kanzo-tech/ui/analytics";
import { useGraphContext } from "@kanzo-tech/graph";
import { corpusKey } from "@/lib/fossil/corpus";
import { useCorpus, useFieldStats } from "./corpus";
import { Finding } from "./finding";
import { OPERATOR_META, type Rule, ruleIdsQuery, runRules } from "./rule-engine";
import { RuleBuilder } from "./rule-fields";
import { ProblemView } from "@/components/problem-view";
import { settled } from "@/lib/api/settled";

/** Rules live in this browser only, per job. */
function createRulesStore(jobId: string) {
  return create<{ rules: Rule[] }>()(persist(() => ({ rules: [] as Rule[] }), { name: `keasy:rules:${jobId}` }));
}

const sentence = (rule: Rule) => {
  const meta = OPERATOR_META[rule.operator];
  const value = meta.needsValues ? (rule.values ?? []).join(", ") : meta.needsValue ? String(rule.value ?? "") : "";
  return `${rule.fieldKey} · ${meta.label.toLowerCase()}${value ? ` ${value}` : ""}`;
};

/**
 * The Rules panel — the data-quality rules, compiled to SQL, with the graph as the report. Each
 * rule's count is one query against its vertex table, re-run as the rules change; pressing a rule
 * selects the vertices that break it, so the canvas lights exactly those, the legend retallies and
 * the inspector reads them. The counts are read against the whole corpus, not the current view: a
 * report that changed as you browsed would be a different question every time you looked.
 */
export function RulesPanel() {
  const { jobId, coordinator, corpus, manifest } = useCorpus();
  const tables = useFieldStats();
  const { select } = useGraphContext();
  const [useRules] = useState(() => createRulesStore(jobId));
  const { rules: current } = useRules();
  // The counts follow the rules a beat behind: the panel keeps the last counts on screen while the
  // new ones are read, instead of falling back to its skeleton on every edit.
  const rules = useDeferredValue(current);

  const results = useSuspenseQuery({
    queryKey: [...corpusKey(jobId), "rules", rules],
    queryFn: () =>
      runRules(
        rules,
        async (q) => (await coordinator.query(q, { type: "json" })) as unknown as Record<string, unknown>[],
        (name) => corpus.relation(name),
      ),
    staleTime: Infinity,
  });
  const counted = settled(results);
  const pending = rules !== current;
  const countOf = (i: number) => counted[i]?.violationCount ?? -1;
  const violations = counted.reduce((n, r) => n + Math.max(r.violationCount, 0), 0);

  const keyOf = (type: string | undefined) => manifest.vertex_tables.find((t) => t.name === type)?.key ?? "dense_id";
  const failingIds = async (rule: Rule) => {
    const query = ruleIdsQuery(rule, corpus.relation(rule.typeName ?? ""), keyOf(rule.typeName));
    return query ? numbers(await coordinator.query(query), "id") : [];
  };

  /** A rule that no longer exists must not keep lighting up vertices. */
  const unfocus = () => select(null);
  const add = (draft: Omit<Rule, "id">) => {
    unfocus();
    useRules.setState((s) => ({ rules: [...s.rules, { id: crypto.randomUUID(), ...draft }] }));
  };
  const remove = (id: string) => {
    unfocus();
    useRules.setState((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  };

  return (
    <ScrollArea className="h-full p-3">
      <div className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-xs">No rules yet. Add one below to check the data.</p>
        ) : pending ? (
          <Skeleton className="h-4 w-32" />
        ) : violations === 0 ? (
          <p className="text-success text-xs">In order — nothing in breach.</p>
        ) : (
          <p className="text-destructive text-xs">{violations.toLocaleString()} violations</p>
        )}

        <ul className="space-y-1">
          {rules.map((rule, i) => {
            const n = countOf(i);
            const broken = n < 0;
            const clean = !pending && n === 0;
            return (
              <li className="flex flex-col gap-1" key={rule.id}>
                <div className="flex items-stretch gap-1">
                  <Finding
                    disabled={pending || clean || broken}
                    label={`${rule.typeName} ${sentence(rule)}`}
                    load={() => failingIds(rule)}
                    source="order"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          pending && "bg-muted-foreground",
                          !pending && (clean ? "bg-success" : broken ? "bg-warning" : "bg-destructive"),
                        )}
                      />
                      <code className="font-mono text-[10px] text-muted-foreground">{rule.typeName}</code>
                      <span className={cn("ms-auto text-xs tabular-nums", pending && "text-muted-foreground")}>
                        {pending ? "…" : clean ? "✓" : broken ? "?" : n.toLocaleString()}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px]">{sentence(rule)}</span>
                  </Finding>
                  <Button
                    aria-label={`Remove ${sentence(rule)}`}
                    className="h-auto shrink-0 self-stretch text-muted-foreground"
                    onClick={() => remove(rule.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                </div>
                {counted[i]?.problem && <ProblemView problem={counted[i].problem} />}
              </li>
            );
          })}
        </ul>

        <RuleBuilder onAdd={add} rules={current} tables={tables} />
      </div>
    </ScrollArea>
  );
}
