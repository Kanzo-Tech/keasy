import type { ConnectionKind } from "@/lib/types";

export const queryKeys = {
  // Auth
  workspaces: ["workspaces"] as const,

  // Jobs
  jobs: {
    all: ["jobs"] as const,
    detail: (id: string) => ["jobs", id] as const,
  },

  // A job's output, opened in the browser. Its own root so invalidating a job never reopens it.
  corpus: (jobId: string) => ["corpus", jobId] as const,

  // Connections
  connections: {
    all: (tab?: ConnectionKind) => (tab ? (["connections", tab] as const) : (["connections"] as const)),
    detail: (id: string) => ["connections", id] as const,
    files: (id: string) => ["connections", id, "files"] as const,
    schema: (id: string, path: string) => ["connections", id, "schema", path] as const,
  },

  // Catalog (governance)
  catalog: {
    datasets: ["catalog-datasets"] as const,
  },

  // Cloud
  cloud: {
    accounts: ["cloud-accounts"] as const,
    detail: (id: string) => ["cloud", id] as const,
  },

  // Settings
  settings: {
    schema: ["schema"] as const,
    providers: ["providers"] as const,
    org: ["settings-org"] as const,
    catalogStorage: ["catalog-storage"] as const,
  },

  // Workspace legal identity
  org: {
    identity: ["org-identity"] as const,
  },

  // AI
  ai: {
    providers: ["ai-providers"] as const,
  },

  // Conversations
  conversations: {
    list: (jobId: string) => ["conversations", jobId] as const,
    messages: (conversationId: string) => ["messages", conversationId] as const,
  },


  // Dashboard
  dashboard: (jobId: string) => ["dashboard", jobId] as const,

} as const;
