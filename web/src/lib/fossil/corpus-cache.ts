import type { Attachment } from "@fossil-lang/corpus";
import type { Query, QueryCache } from "@tanstack/react-query";

const CORPUS = "corpus";

/** The root of every cached read of a graph's attached output; its own, so invalidating a graph never reattaches it. */
export const corpusKey = (graphId: string) => [CORPUS, graphId] as const;

/** What the failure path says when an attachment does not detach: the same wherever it is detached. */
export const RELEASE_FAILED = "The graph's data could not be released";

/** The graph whose corpus entry `query` is — `corpusKey(graphId)` itself, not a read under it — or nothing. */
function corpusOf(query: Query): string | undefined {
  const [root, graphId, ...rest] = query.queryKey;
  return root === CORPUS && typeof graphId === "string" && rest.length === 0 ? graphId : undefined;
}

/**
 * The one owner of the corpora `cache` holds: it detaches each attachment exactly once, when its
 * entry under {@link corpusKey} lets it go —
 *
 * - **removed**: `gcTime` after the corpus's last observer went, or the whole cache cleared. Every read
 *   cached under it goes with it: they were read off an attachment that is gone.
 * - **replaced**: a refetch landed a new attachment; the old one goes once the new one holds the catalog.
 * - **reset to no data** (`resetQueries`): at once when nothing reads the entry; under a reader, the
 *   attachment it was drawn from is kept until the entry has its new one, or is removed.
 *
 * The cache decides when, so whatever a page left queued on the engine (Mosaic's re-queries, its
 * pre-aggregator's tables) has long run by then. An attach the cache gave up on while it was out is
 * never an entry's: its query function detaches it. A detach that fails reaches `onFailure`, once.
 * Registered once, beside the app's query client (`app/providers.tsx`); the reporter is handed in,
 * so this module stays free of the app's failure path, which imports the API client.
 */
export function releaseCorpora(cache: QueryCache, { onFailure }: { onFailure: (error: unknown) => void }): () => void {
  // The attachment each corpus entry holds, or was last drawn from while a reader still reads it.
  const held = new Map<Query, Attachment>();
  const detach = (attachment: Attachment) => void attachment.detach().catch(onFailure);
  const release = (query: Query) => {
    const attachment = held.get(query);
    held.delete(query);
    if (attachment) detach(attachment);
  };
  return cache.subscribe((event) => {
    const { query } = event;
    const graphId = corpusOf(query);
    if (graphId === undefined) return;
    if (event.type === "removed") {
      for (const read of cache.findAll({ queryKey: corpusKey(graphId) })) cache.remove(read);
      release(query);
      return;
    }
    const current = (query.state.data as { attachment: Attachment } | undefined)?.attachment;
    const previous = held.get(query);
    if (current === previous) return;
    if (current !== undefined) {
      held.set(query, current);
      if (previous) detach(previous);
    } else if (query.getObserversCount() === 0) {
      release(query);
    }
  });
}
