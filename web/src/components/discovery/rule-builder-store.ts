/**
 * Rule Builder Zustand store — replaces useState + manual localStorage.
 * Uses Zustand persist middleware for automatic localStorage sync.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Rule, RuleResult } from "@/lib/rule-engine";

interface RuleBuilderState {
  rules: Rule[];
  results: RuleResult[];
  running: boolean;

  addRule: (typeName: string, fieldKey: string) => void;
  updateRule: (id: string, updated: Rule) => void;
  removeRule: (id: string) => void;
  setResults: (results: RuleResult[]) => void;
  setRunning: (running: boolean) => void;
  reset: () => void;
}

/**
 * Create a rule-builder store scoped to a jobId.
 * Each jobId gets its own persisted rules in localStorage.
 */
export function createRuleBuilderStore(jobId: string) {
  return create<RuleBuilderState>()(
    persist(
      (set) => ({
        rules: [],
        results: [],
        running: false,

        addRule: (typeName, fieldKey) =>
          set((s) => ({
            rules: [...s.rules, { id: crypto.randomUUID(), fieldKey, operator: "not_null", typeName }],
          })),

        updateRule: (id, updated) =>
          set((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) })),

        removeRule: (id) =>
          set((s) => ({ rules: s.rules.filter((r) => r.id !== id), results: s.results.filter((r) => r.rule.id !== id) })),

        setResults: (results) => set({ results }),
        setRunning: (running) => set({ running }),
        reset: () => set({ rules: [], results: [], running: false }),
      }),
      {
        name: `keasy:rules:${jobId}`,
        partialize: (s) => ({ rules: s.rules }), // only persist rules, not results/running
      },
    ),
  );
}
