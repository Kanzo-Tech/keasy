import type { Schemas } from "@/lib/api/client";

export function isTerminalStatus(status: Schemas["JobStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Schemas["Job"][] | undefined): boolean {
  return jobs?.some((j) => !isTerminalStatus(j.status)) ?? false;
}
