/**
 * Job Editor Zustand store — replaces 8 useState in job-editor.tsx.
 * Manages wizard step, form inputs, validation, and creation mode.
 */

import { create } from "zustand";
import type { RunMode, CreationMode } from "@/lib/types";

interface JobEditorState {
  // Wizard
  step: number;
  creationMode: CreationMode | null;

  // Form inputs
  script: string;
  name: string;
  mode: RunMode;
  dcatEnabled: boolean;
  // The connection the member picks as the output destination (job config).
  sinkConnectionId: string | null;

  // Validation — the editor's browser LSP validates inline; the wizard only
  // tracks the transient spinner while advancing to review.
  validating: boolean;

  // Actions
  setStep: (step: number) => void;
  setCreationMode: (mode: CreationMode | null) => void;
  setScript: (script: string) => void;
  setName: (name: string) => void;
  setMode: (mode: RunMode) => void;
  setDcatEnabled: (enabled: boolean) => void;
  setSinkConnectionId: (id: string | null) => void;
  setValidating: (validating: boolean) => void;

  // Compound actions
  selectMode: (mode: CreationMode) => void;
  goToScript: () => void;
  goToConfig: () => void;
  goToReview: () => void;
  goBack: () => void;
  completeAssistant: (generatedScript: string) => void;
  restoreDraft: (script: string, name: string, mode: RunMode) => void;
  reset: () => void;
}

export const useJobEditorStore = create<JobEditorState>((set) => ({
  step: 0,
  creationMode: null,
  script: "",
  name: "",
  mode: "integrated",
  dcatEnabled: false,
  sinkConnectionId: null,
  validating: false,

  setStep: (step) => set({ step }),
  setCreationMode: (creationMode) => set({ creationMode }),
  setScript: (script) => set({ script }),
  setName: (name) => set({ name }),
  setMode: (mode) => set({ mode }),
  setDcatEnabled: (dcatEnabled) => set({ dcatEnabled }),
  setSinkConnectionId: (sinkConnectionId) => set({ sinkConnectionId }),
  setValidating: (validating) => set({ validating }),

  selectMode: (mode) => set({ creationMode: mode, step: 1 }),
  goToScript: () => set({ step: 1 }),
  goToConfig: () => set({ step: 2 }),
  goToReview: () => set({ step: 3 }),
  goBack: () => set((s) => {
    if (s.step === 1) return { step: 0, creationMode: null };
    if (s.step === 2) return { step: 1 };
    if (s.step === 3) return { step: 2 };
    return {};
  }),
  completeAssistant: (generatedScript) => set({ script: generatedScript, creationMode: "studio" }),
  restoreDraft: (script, name, mode) => set({ script, name, mode, creationMode: "studio", step: 1 }),
  reset: () => set({
    step: 0, creationMode: null, script: "", name: "",
    mode: "integrated", dcatEnabled: false, sinkConnectionId: null, validating: false,
  }),
}));
