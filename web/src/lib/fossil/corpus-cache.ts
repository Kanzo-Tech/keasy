import type { Attachment } from "@fossil-lang/corpus";
import type { QueryCache } from "@tanstack/react-query";

const CORPUS = "corpus";

/** The root of every cached read of a graph's attached output; its own, so invalidating a graph never reattaches it. */
export const corpusKey = (graphId: string) => [CORPUS, graphId] as const;

/**
 * Detach each corpus when `cache` removes its entry under {@link corpusKey}, and drop every read
 * cached under it with it: they were read off an attachment that is gone. The cache decides when —
 * `gcTime` after the corpus's last observer went, or when the whole cache is cleared — so whatever
 * a page left queued on the engine (Mosaic's re-queries, its pre-aggregator's tables) has long run
 * by then. Registered once, by the cache that holds the corpora.
 */
export function releaseCorpora(cache: QueryCache): () => void {
  return cache.subscribe((event) => {
    if (event.type !== "removed") return;
    const [root, graphId, ...rest] = event.query.queryKey;
    if (root !== CORPUS || typeof graphId !== "string" || rest.length > 0) return;
    for (const read of cache.findAll({ queryKey: corpusKey(graphId) })) cache.remove(read);
    const opened = event.query.state.data as { attachment: Attachment } | undefined;
    void opened?.attachment.detach();
  });
}
