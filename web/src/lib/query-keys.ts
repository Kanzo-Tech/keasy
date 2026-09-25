export const queryKeys = {
  // Jobs
  jobs: {
    all: ["jobs"] as const,
    detail: (id: string) => ["jobs", id] as const,
  },


  // Settings
  settings: {
    // The source providers fossil supports.
    providers: ["providers"] as const,
  },
} as const;
