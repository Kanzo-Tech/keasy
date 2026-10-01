import type { Schemas } from "@/lib/api/client";
import type { Shown } from "@/lib/errors";

export function isTerminalStatus(status: Schemas["JobStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Schemas["Job"][] | undefined): boolean {
  return jobs?.some((j) => !isTerminalStatus(j.status)) ?? false;
}

/** Why a failed run failed: the problem the browser stored, opaque to the server. */
export function runProblem(job: Schemas["Job"]): Shown | null {
  return (job.problem as Shown | undefined) ?? null;
}
