import type { Job, JobStatus } from "@/lib/types";

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Job[] | undefined): boolean {
  return jobs?.some((j) => !isTerminalStatus(j.status)) ?? false;
}
