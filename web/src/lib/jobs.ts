import type { Schemas } from "@/lib/api/client";

export function isTerminalStatus(status: Schemas["JobStatus"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function hasRunningJobs(jobs: Schemas["Job"][] | undefined): boolean {
  return jobs?.some((j) => !isTerminalStatus(j.status)) ?? false;
}

/**
 * fossil's executor refuses a run that would outgrow its memory budget with an
 * `Error` named `OverBudget`, before it writes anything. The job keeps that
 * fact in its error text under this prefix, so every view of the job can say
 * it in a reader's words and keep fossil's own sentence as the detail.
 */
const OVER_BUDGET = "OverBudget: ";

/** The error text a failed run is stored with. */
export function runFailure(err: unknown): string {
  if (err instanceof Error) return err.name === "OverBudget" ? `${OVER_BUDGET}${err.message}` : err.message;
  return String(err);
}

/** fossil's own message when the run was refused as too large for the browser, else `null`. */
export function overBudget(error: string | null | undefined): string | null {
  return error?.startsWith(OVER_BUDGET) ? error.slice(OVER_BUDGET.length) : null;
}
