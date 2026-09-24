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
  },

  // Source bindings described in the browser
  sourceDescriptors: (bindings: string[], connections: string[]) =>
    ["source-descriptors", bindings, connections] as const,

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
} as const;
