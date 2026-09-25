import type { GraphSchema } from "@/lib/graph-schema";

/**
 * Generate starter question suggestions programmatically from graph schema.
 * Inspired by ThoughtSpot / Tableau Ask Data — instant, no LLM cost.
 */
export function generateSuggestions(schema: GraphSchema): string[] {
  const suggestions: string[] = [];

  for (const t of schema.types) {
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
    if (t.entityCount > 0) {
      suggestions.push(`How many ${t.name} entities are there?`);
    }
  }

  for (const e of schema.edges) {
    suggestions.push(`How are ${e.sourceType} connected to ${e.targetType}?`);
  }

  return [...new Set(suggestions)].slice(0, 4);
}
