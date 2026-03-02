import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Job } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}


export function hasRunningJobs(jobs: Job[] | undefined): boolean {
  return (
    jobs?.some((j) => j.status === "pending" || j.status === "running") ?? false
  );
}
