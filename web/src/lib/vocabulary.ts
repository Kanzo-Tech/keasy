/**
 * The interface's one vocabulary: Graph · Recipe · Run · Output · Explore · Workspace storage.
 *
 * The API names the entity the same (`/v1/graphs`, `Graph`). Copy builds its sentences from these
 * words, so renaming what a person reads is an edit here, not a hunt.
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
