/**
 * Who says a failed dashboard write: whoever waits on it. The editor's writes run after its pause,
 * when nobody waits, so the page says their failure (a toast). *Add to the dashboard* is awaited by
 * `AnswerCard`, which draws a rejection in the card, so the page says nothing more — said twice, one
 * failure reads as two.
 *
 * Both reach the server through `useDebouncedCommit`'s one `onCommit`, which cannot tell them apart,
 * so the add marks its commit as awaited for the call. `onCommit` runs synchronously inside
 * `commit`, which is what makes the mark exact.
 */
export function dashboardWrites(report: (error: unknown) => void) {
  let awaited = false;
  return {
    /** `onCommit`'s write: `write()`, its failure reported unless the commit is awaited. */
    write<R>(write: () => Promise<R>): Promise<R> {
      const written = write();
      if (!awaited) written.catch(report);
      return written;
    },
    /** `commit` run by a caller that waits on the write and says its failure itself. */
    awaited<R>(commit: () => R): R {
      awaited = true;
      try {
        return commit();
      } finally {
        awaited = false;
      }
    },
  };
}
