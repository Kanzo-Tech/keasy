import { create } from "zustand";

interface AskMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sql?: string;
  code?: string;
  reasoning?: string;
  explanation?: string;
  phase?: "generating" | "executing" | "explaining" | "done";
}

interface DiscoveryAskState {
  messages: AskMessage[];
  loading: boolean;
  conversationId: string | null;
  selectedProvider: string;

  addUserMessage: (content: string) => string;
  addPlaceholder: () => string;
  updateMessage: (id: string, patch: Partial<AskMessage>) => void;
  setLoading: (loading: boolean) => void;
  setConversationId: (id: string) => void;
  setSelectedProvider: (provider: string) => void;
  reset: () => void;
}

export const createDiscoveryAskStore = () =>
  create<DiscoveryAskState>((set, get) => ({
    messages: [],
    loading: false,
    conversationId: null,
    selectedProvider: "",

    addUserMessage: (content) => {
      const id = crypto.randomUUID();
      const msg: AskMessage = {
        id,
        conversation_id: get().conversationId ?? "",
        role: "user",
        content,
        created_at: new Date().toISOString(),
      };
      set((s) => ({ messages: [...s.messages, msg] }));
      return id;
    },

    addPlaceholder: () => {
      const id = crypto.randomUUID();
      const msg: AskMessage = {
        id,
        conversation_id: get().conversationId ?? "",
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
        phase: "generating",
      };
      set((s) => ({ messages: [...s.messages, msg] }));
      return id;
    },

    updateMessage: (id, patch) => {
      set((s) => ({
        messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      }));
    },

    setLoading: (loading) => set({ loading }),
    setConversationId: (id) => set({ conversationId: id }),
    setSelectedProvider: (provider) => set({ selectedProvider: provider }),
    reset: () => set({ messages: [], loading: false, conversationId: null }),
  }));
