import type { Job, Connection } from "@/lib/types";

export function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return "";
  if (ms < 1000) return "<1s";
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatJobDuration(job: Job): string {
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

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extract the local name from a full IRI (after last `/` or `#`). */
export function localName(iri: string): string {
  const clean = iri.replace(/^<|>$/g, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("#"));
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

/** Strip redundant node references and technical noise from validation messages. */
/** Reverse-map a URL to @connection-name/path using the given connections. */
export function reverseMapUrl(url: string, connections: Connection[]): string {
  for (const connection of connections) {
    const base = connection.url.replace(/\/+$/, "");
    if (url.startsWith(base)) {
      const path = url.slice(base.length).replace(/^\/+/, "");
      return path ? `@${connection.name}/${path}` : `@${connection.name}`;
    }
  }
  return url;
}

export function cleanValidationMessage(message: string, node: string): string {
  let msg = message
    .replace(new RegExp(`\\s*for node\\s+<?${node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?`, "gi"), "")
    .replace(/\s*for node\s+\S+/gi, "");

  msg = msg.replace(/ShapeRef fails\s*(?:with idx:\s*\d+)?/i, "Does not conform to shape");
  msg = msg.replace(/^Error\s+/i, "");

  return msg.trim() || message;
}
