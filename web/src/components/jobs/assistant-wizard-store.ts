/**
 * Assistant Wizard Zustand store — replaces 7 useState + sync effects.
 * No persist: wizard state is ephemeral (resets on navigation).
 * Maps/Sets are fine in memory (no serialization needed).
 */

import { create } from "zustand";
import type { RowSelectionState } from "@tanstack/react-table";
import type { CompetencyQuestion } from "@/lib/types";

export interface ReqEntry extends CompetencyQuestion {
  enabled: boolean;
}

interface AssistantWizardState {
  step: number;
  connRowSelection: RowSelectionState;
  fileSelection: Map<string, Set<string>>;
  fileCounts: Map<string, number>;
  domain: string;
  reqs: ReqEntry[];

  // Actions
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setConnRowSelection: (selection: RowSelectionState) => void;
  setDomain: (domain: string) => void;
  setReqs: (reqs: ReqEntry[]) => void;

  // File selection
  toggleFile: (connId: string, path: string) => void;
  selectAllFiles: (connId: string, paths: string[]) => void;
  setSupportedCount: (connId: string, count: number) => void;

  // Sync: clean up file selection when connections change
  cleanupForDeselectedConnections: (selectedIds: Set<string>) => void;
  deselectEmptyConnections: (selectedIds: Set<string>) => void;

  reset: () => void;
}

export const useAssistantWizardStore = create<AssistantWizardState>((set, get) => ({
  step: 0,
  connRowSelection: {},
  fileSelection: new Map(),
  fileCounts: new Map(),
  domain: "",
  reqs: [],

  setStep: (step) => set({ step }),
  nextStep: () => set((s) => ({ step: s.step + 1 })),
  prevStep: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
  setConnRowSelection: (connRowSelection) => set({ connRowSelection }),
  setDomain: (domain) => set({ domain }),
  setReqs: (reqs) => set({ reqs }),

  toggleFile: (connId, path) => set((s) => {
    const next = new Map(s.fileSelection);
    const paths = new Set(next.get(connId) ?? []);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    next.set(connId, paths);
    return { fileSelection: next };
  }),

  selectAllFiles: (connId, paths) => set((s) => {
    const next = new Map(s.fileSelection);
    const existing = new Set(next.get(connId) ?? []);
    for (const p of paths) existing.add(p);
    next.set(connId, existing);
    return { fileSelection: next };
  }),

  setSupportedCount: (connId, count) => set((s) => {
    if (s.fileCounts.get(connId) === count) return s;
    const next = new Map(s.fileCounts);
    next.set(connId, count);
    return { fileCounts: next };
  }),

  cleanupForDeselectedConnections: (selectedIds) => set((s) => {
    let changed = false;
    const next = new Map(s.fileSelection);
    for (const connId of next.keys()) {
      if (!selectedIds.has(connId)) {
        next.delete(connId);
        changed = true;
      }
    }
    return changed ? { fileSelection: next } : {};
  }),

  deselectEmptyConnections: (selectedIds) => {
    const s = get();
    const toDeselect: string[] = [];
    for (const connId of selectedIds) {
      const total = s.fileCounts.get(connId);
      const selected = s.fileSelection.get(connId);
      if (total !== undefined && total > 0 && selected !== undefined && selected.size === 0) {
        toDeselect.push(connId);
      }
    }
    if (toDeselect.length > 0) {
      set((prev) => {
        const next = { ...prev.connRowSelection };
        for (const id of toDeselect) delete next[id];
        return { connRowSelection: next };
      });
    }
  },

  reset: () => set({
    step: 0, connRowSelection: {}, fileSelection: new Map(),
    fileCounts: new Map(), domain: "", reqs: [],
  }),
}));
