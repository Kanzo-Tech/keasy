import type { Schemas } from "@/lib/api/client";

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "";
  if (ms < 1000) return "<1s";
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatJobDuration(job: Schemas["Job"]): string {
  if (!job.started_at) return "";
  const end = job.completed_at ?? new Date().toISOString();
  return formatDuration(job.started_at, end);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateStr));
}


/** The first letters of a name's first two words, for an avatar with no picture. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
