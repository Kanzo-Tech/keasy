import type { Job } from "@/lib/types"

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Job[] | undefined): boolean {
  return (
    jobs?.some((j) => !isTerminalStatus(j.status)) ?? false
  );
}
