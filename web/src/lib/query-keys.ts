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

  // A program's sources as fossil resolved them, and their descriptions
  programSources: (program: string) => ["program-sources", program] as const,
  sourceDescriptors: (sources: string[]) => ["source-descriptors", sources] as const,

  datasets: ["datasets"] as const,

  // Settings
  settings: {
    // The source providers fossil supports.
    providers: ["providers"] as const,
  },
} as const;
