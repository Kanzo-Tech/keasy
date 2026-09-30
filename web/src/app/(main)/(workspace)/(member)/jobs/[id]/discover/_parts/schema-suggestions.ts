import type { Manifest } from "@fossil-lang/corpus";
import type { TableStats } from "./field-stats";

/**
 * Generate starter question suggestions programmatically from the corpus's tables.
 * Inspired by ThoughtSpot / Tableau Ask Data — instant, no LLM cost.
 */
export function generateSuggestions(tables: TableStats[], manifest: Manifest): string[] {
  const suggestions: string[] = [];

  for (const t of tables) {
    const dims = t.fields.filter((f) => f.role === "dimension");
    const measures = t.fields.filter((f) => f.role === "measure");

    if (dims.length > 0) {
      suggestions.push(`What are the most common ${dims[0].name} in ${t.name}?`);
    }
    if (measures.length > 0 && dims.length > 0) {
      suggestions.push(`Top 10 ${t.name} by ${measures[0].name}`);
    }
    if (measures.length > 0) {
      suggestions.push(`Show the distribution of ${measures[0].name}`);
    }
    if (t.count > 0) {
      suggestions.push(`How many ${t.name} entities are there?`);
    }
  }

  for (const e of manifest.edge_tables) {
    suggestions.push(`How are ${e.source.references} connected to ${e.destination.references}?`);
  }

  return [...new Set(suggestions)].slice(0, 4);
}
