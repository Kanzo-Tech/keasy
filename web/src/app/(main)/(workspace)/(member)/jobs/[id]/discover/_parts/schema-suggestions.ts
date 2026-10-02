import type { TableStats } from "./field-stats";

/** An edge table's two ends, as `fossil_tables` names them. */
export interface Edge {
  source: string;
  destination: string;
}

/**
 * Generate starter question suggestions programmatically from the corpus's tables.
 * Inspired by ThoughtSpot / Tableau Ask Data — instant, no LLM cost.
 */
export function generateSuggestions(tables: readonly TableStats[], edges: readonly Edge[]): string[] {
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
    suggestions.push(`How many ${t.name} entities are there?`);
  }

  for (const e of edges) {
    suggestions.push(`How are ${e.source} connected to ${e.destination}?`);
  }

  return [...new Set(suggestions)].slice(0, 4);
}
