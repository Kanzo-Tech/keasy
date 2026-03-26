/**
 * Job Editor Zustand store — replaces 8 useState in job-editor.tsx.
 * Manages wizard step, form inputs, validation, and creation mode.
 */

import { create } from "zustand";
import type { RunMode, ValidationResult, CreationMode } from "@/lib/types";

interface JobEditorState {
  // Wizard
  step: number;
  creationMode: CreationMode | null;

  // Form inputs
  script: string;
  name: string;
  mode: RunMode;
  dcatEnabled: boolean;

  // Validation
  validating: boolean;
  validation: ValidationResult | null;

  // Actions
  setStep: (step: number) => void;
  setCreationMode: (mode: CreationMode | null) => void;
  setScript: (script: string) => void;
  setName: (name: string) => void;
  setMode: (mode: RunMode) => void;
  setDcatEnabled: (enabled: boolean) => void;
  setValidating: (validating: boolean) => void;
  setValidation: (validation: ValidationResult | null) => void;

  // Compound actions
  selectMode: (mode: CreationMode) => void;
  goToScript: () => void;
  goToConfig: () => void;
  goToReview: (validation: ValidationResult) => void;
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
  validating: false,
  validation: null,

  setStep: (step) => set({ step }),
  setCreationMode: (creationMode) => set({ creationMode }),
  setScript: (script) => set({ script }),
  setName: (name) => set({ name }),
  setMode: (mode) => set({ mode }),
  setDcatEnabled: (dcatEnabled) => set({ dcatEnabled }),
  setValidating: (validating) => set({ validating }),
  setValidation: (validation) => set({ validation }),

  selectMode: (mode) => set({ creationMode: mode, step: 1 }),
  goToScript: () => set({ step: 1 }),
  goToConfig: () => set({ step: 2 }),
  goToReview: (validation) => set({ step: 3, validation }),
  goBack: () => set((s) => {
    if (s.step === 1) return { step: 0, creationMode: null };
    if (s.step === 2) return { step: 1 };
    if (s.step === 3) return { step: 2, validation: null };
    return {};
  }),
  completeAssistant: (generatedScript) => set({ script: generatedScript, creationMode: "studio" }),
  restoreDraft: (script, name, mode) => set({ script, name, mode, creationMode: "studio", step: 1 }),
  reset: () => set({
    step: 0, creationMode: null, script: "", name: "",
    mode: "integrated", dcatEnabled: false, validating: false, validation: null,
  }),
}));
