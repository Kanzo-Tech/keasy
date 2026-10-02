/**
 * The job studio's draft — one program, its name, and the three settings that
 * are not in it.

 */

import { create } from "zustand";

export type CreationMode = "studio" | "assistant";

interface JobEditorState {
  /** `null` until the member has chosen how to write the program. */
  creationMode: CreationMode | null;

  script: string;
  name: string;
  /** The connection the member picks as the output destination. */
  sinkConnectionId: string | null;
  /** The output's folder under the sink; `null` follows the name's slug. */
  folder: string | null;

  setCreationMode: (mode: CreationMode | null) => void;
  setScript: (script: string) => void;
  setName: (name: string) => void;
  setSinkConnectionId: (id: string | null) => void;
  setFolder: (folder: string | null) => void;

  completeAssistant: (generatedScript: string) => void;
  restoreDraft: (
    script: string,
    name: string,
    sinkConnectionId: string | null,
    folder: string | null,
  ) => void;
  reset: () => void;
}

const EMPTY = {
  creationMode: null,
  script: "",
  name: "",
  sinkConnectionId: null,
  folder: null,
};

export const useJobEditorStore = create<JobEditorState>((set) => ({
  ...EMPTY,

  setCreationMode: (creationMode) => set({ creationMode }),
  setScript: (script) => set({ script }),
  setName: (name) => set({ name }),
  setSinkConnectionId: (sinkConnectionId) => set({ sinkConnectionId }),
  setFolder: (folder) => set({ folder }),

  completeAssistant: (script) => set({ script, creationMode: "studio" }),
  restoreDraft: (script, name, sinkConnectionId, folder) =>
    set({ script, name, sinkConnectionId, folder, creationMode: "studio" }),
  reset: () => set(EMPTY),
}));
