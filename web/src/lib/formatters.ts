import type { Job } from "@/lib/types";

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
  const start = job.started_at ?? job.created_at;
  const end = job.completed_at ?? new Date().toISOString();
  return formatDuration(start, end);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SHAPE_EXTENSIONS = [".shex", ".ttl", ".shapes.ttl"];

export function isShapeFile(path: string): boolean {
  return SHAPE_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));
}

/** Detect the shape format from a file path extension. */
export function detectShapeFormat(path: string): "ShEx" | "SHACL" | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".shex")) return "ShEx";
  if (lower.endsWith(".ttl")) return "SHACL";
  return null;
}

/** Extract the local name from a full IRI (after last `/` or `#`). */
export function localName(iri: string): string {
  const clean = iri.replace(/^<|>$/g, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("#"));
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

/** Strip redundant node references and technical noise from validation messages. */
export function cleanValidationMessage(message: string, node: string): string {
  let msg = message
    .replace(new RegExp(`\\s*for node\\s+<?${node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>?`, "gi"), "")
    .replace(/\s*for node\s+\S+/gi, "");

  msg = msg.replace(/ShapeRef fails\s*(?:with idx:\s*\d+)?/i, "Does not conform to shape");
  msg = msg.replace(/^Error\s+/i, "");

  return msg.trim() || message;
}
