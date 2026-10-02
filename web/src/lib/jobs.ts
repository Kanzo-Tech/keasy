import type { Schemas } from "@/lib/api/client";
import type { Shown } from "@/lib/errors";

export function isTerminalStatus(status: Schemas["JobStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/** Whether a run is under way: a draft is not one, and polling for it would never stop. */
export function isRunning(status: Schemas["JobStatus"]): boolean {
  return status === "pending" || status === "running";
}

export function hasRunningJobs(jobs: Schemas["Job"][] | undefined): boolean {
  return jobs?.some((j) => isRunning(j.status)) ?? false;
}

/**
 * A `refetchInterval` that polls every `ms` while `running(data)`, and stops once the query is in
 * error — a dead API is not asked forever, and the failure, not the last good answer, is shown.
 */
export function pollWhile<T>(running: (data: T | undefined) => boolean, ms: number) {
  return (query: { state: { status: string; data: T | undefined } }): number | false =>
    query.state.status !== "error" && running(query.state.data) ? ms : false;
}

/** Why a failed run failed: the problem the browser stored, opaque to the server. */
export function runProblem(job: Schemas["Job"]): Shown | null {
  return (job.problem as Shown | undefined) ?? null;
}
