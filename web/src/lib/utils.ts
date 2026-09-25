import type { ProviderInfo } from "@fossil-lang/wasm";

import type { Schemas } from "@/lib/api/client";

type Job = Schemas["Job"];
type JobStatus = Schemas["JobStatus"];

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Job[] | undefined): boolean {
  return jobs?.some((j) => !isTerminalStatus(j.status)) ?? false;
}

/** The files some provider can read as `kind`, by extension. */
export function readableFiles<T extends { path: string }>(
  files: T[],
  providers: ProviderInfo[],
  kind: "data" | "schema",
): T[] {
  const extensions = new Set(
    providers.filter((p) => p.kind === "both" || p.kind === kind).flatMap((p) => p.extensions),
  );
  return files.filter((f) => extensions.has(f.path.split(".").pop()?.toLowerCase() ?? ""));
}
