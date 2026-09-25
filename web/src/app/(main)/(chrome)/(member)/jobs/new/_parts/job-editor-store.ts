/**
 * The job studio's draft — one program, its name, and the three settings that
 * are not in it.
 *
 * `step` is a page index now rather than a wizard cursor: `Steps` owns the
 * navigation and every page is reachable, so the compound `goToConfig` /
 * `goToReview` / `goBack` transitions that encoded a one-way walk are gone. So is
 * `validating`: nothing ever set it. The editor's diagnostics come from the
 * compiler as you type and gate Create directly.
 */

import { create } from "zustand";
import type { CreationMode } from "@/lib/types";

interface JobEditorState {
  /** `null` until the member has chosen how to write the program. */
  creationMode: CreationMode | null;
  /** 0 Editor · 1 Configure · 2 Summary. */
  step: number;

  script: string;
  name: string;
  dcatEnabled: boolean;
  /** The connection the member picks as the output destination. */
  sinkConnectionId: string | null;

  setCreationMode: (mode: CreationMode | null) => void;
  setStep: (step: number) => void;
  setScript: (script: string) => void;
  setName: (name: string) => void;
  setDcatEnabled: (enabled: boolean) => void;
  setSinkConnectionId: (id: string | null) => void;

  completeAssistant: (generatedScript: string) => void;
  restoreDraft: (script: string, name: string, sinkConnectionId: string | null) => void;
  reset: () => void;
}

const EMPTY = {
  creationMode: null,
  step: 0,
  script: "",
  name: "",
  dcatEnabled: false,
  sinkConnectionId: null,
};

export const useJobEditorStore = create<JobEditorState>((set) => ({
  ...EMPTY,

  setCreationMode: (creationMode) => set({ creationMode }),
  setStep: (step) => set({ step }),
  setScript: (script) => set({ script }),
  setName: (name) => set({ name }),
  setDcatEnabled: (dcatEnabled) => set({ dcatEnabled }),
  setSinkConnectionId: (sinkConnectionId) => set({ sinkConnectionId }),

  completeAssistant: (script) => set({ script, creationMode: "studio", step: 0 }),
  restoreDraft: (script, name, sinkConnectionId) =>
    set({ script, name, sinkConnectionId, creationMode: "studio", step: 0 }),
  reset: () => set(EMPTY),
}));
