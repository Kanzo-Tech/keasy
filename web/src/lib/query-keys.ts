export const queryKeys = {
  // Auth
  me: ["auth-me"] as const,
  workspaces: ["workspaces"] as const,

  // Jobs
  jobs: {
    all: ["jobs"] as const,
    detail: (id: string) => ["jobs", id] as const,
    catalog: (id: string, format: string) => ["jobs", id, "catalog", format] as const,
  },

  // Connections (backed by /v1/connectors)
  connections: {
    all: (direction?: string) => (direction ? ["connections", direction] as const : ["connections"] as const),
    detail: (id: string) => ["connections", id] as const,
    files: (id: string) => ["connections", id, "files"] as const,
    schema: (id: string, paths: string[]) => ["connections", id, "schema", paths] as const,
    kinds: () => ["connection-kinds"] as const,
  },

  // Settings
  settings: {
    providers: ["providers"] as const,
    org: ["settings-org"] as const,
    preferences: ["preferences"] as const,
    catalogStorage: ["catalog-storage"] as const,
  },

  // Org
  org: {
    identity: ["org-identity"] as const,
    users: ["org-users"] as const,
    invites: ["org-invites"] as const,
  },

  // Admin
  admin: {
    orgs: ["admin-orgs"] as const,
    invites: ["admin-invites"] as const,
  },

  // AI
  ai: {
    providers: ["ai-providers"] as const,
  },

  // Gaia-X
  gx: {
    compliance: ["gx-compliance-status"] as const,
  },

  // Services
  services: ["service-status"] as const,

} as const;
