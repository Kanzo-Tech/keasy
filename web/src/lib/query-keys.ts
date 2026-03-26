import type { ConnectionKind } from "@/lib/types";

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

  // Connections
  connections: {
    all: (tab?: ConnectionKind) => (tab ? (["connections", tab] as const) : (["connections"] as const)),
    detail: (id: string) => ["connections", id] as const,
    files: (id: string) => ["connections", id, "files"] as const,
    schema: (id: string, path: string) => ["connections", id, "schema", path] as const,
    init: (tab: ConnectionKind) => ["connections-init", tab] as const,
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

  // Conversations
  conversations: {
    list: (jobId: string) => ["conversations", jobId] as const,
    messages: (conversationId: string) => ["messages", conversationId] as const,
  },


  // Dashboard
  dashboard: (jobId: string) => ["dashboard", jobId] as const,

} as const;
