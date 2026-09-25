import type { ConnectionKind } from "@/lib/types";

export const queryKeys = {
  // Jobs
  jobs: {
    all: ["jobs"] as const,
    detail: (id: string) => ["jobs", id] as const,
  },

  // Connections
  connections: {
    all: (tab?: ConnectionKind) => (tab ? (["connections", tab] as const) : (["connections"] as const)),
    detail: (id: string) => ["connections", id] as const,
    files: (id: string) => ["connections", id, "files"] as const,
    // Under `connections`, so adding or deleting one drops the map with it.
    refs: ["connections", "refs"] as const,
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
    catalogStorage: ["catalog-storage"] as const,
  },

  // AI
  ai: {
    providers: ["ai-providers"] as const,
    catalog: ["ai-catalog"] as const,
  },
} as const;
