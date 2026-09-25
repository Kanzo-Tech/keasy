import type { SchemaResult } from "@fossil-lang/corpus";

/**
 * Generate starter question suggestions programmatically from graph schema.
 * Inspired by ThoughtSpot / Tableau Ask Data — instant, no LLM cost.
 */
export function generateSuggestions(schema: SchemaResult): string[] {
  const suggestions: string[] = [];

  for (const t of schema.vertices) {
    const dims = t.stats.filter((f) => f.role === "dimension");
    const measures = t.stats.filter((f) => f.role === "measure");

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

  for (const e of schema.edges) {
    suggestions.push(`How are ${e.source_type} connected to ${e.target_type}?`);
  }

  return [...new Set(suggestions)].slice(0, 4);
}
