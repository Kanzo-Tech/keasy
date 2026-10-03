/**
 * The interface's one vocabulary: Graph · Recipe · Run · Output · Explore · Workspace storage.
 *
 * The API still calls the entity a job (`/v1/jobs`, `Job`); what a person reads calls it this. Copy
 * builds its sentences from these words, so renaming the entity is an edit here, not a hunt.
 */
export const WORDS = {
  graph: "Graph",
  graphs: "Graphs",
  recipe: "Recipe",
  run: "Run",
  output: "Output",
  explore: "Explore",
  storage: "Workspace storage",
} as const;

/** A word as it reads mid-sentence. */
export function lower(word: string): string {
  return word.toLowerCase();
}
