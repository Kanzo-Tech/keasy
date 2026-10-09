import { useDebouncedCommit } from "@kanzo-tech/ui";
import type { Dashboards } from "@kanzo-tech/ui/analytics";

export interface DashboardWritesOptions {
  /** Writes a document. The writes must land in the order they were made: the store's mutation is scoped. */
  write: (next: Dashboards) => Promise<unknown>;
  /** Says a failed write nobody waits on: the editor's. */
  report: (error: unknown) => void;
  /** The editor's pause before it writes. */
  delay: number;
}

/**
 * The two ways the saved dashboards are written, each owning its failure.
 *
 * - **`change`**, the editor's: the draft now, the write once editing pauses. Nobody waits on that
 *   write, so its failure is reported here.
 * - **`add`**, *Add to the dashboard*'s: written now, and the promise handed back to `AnswerCard`,
 *   which draws the failure — so it is not reported here too. A pending edit is written first
 *   (`flush`), so it is not dropped, and its later write cannot land over the add's. `next` was
 *   built from the draft, so it holds the edit as well.
 */
export function useDashboardWrites(stored: Dashboards | undefined, { write, report, delay }: DashboardWritesOptions) {
  const { draft, change, flush } = useDebouncedCommit(
    stored,
    // Only ever a document: nothing commits before the read has settled.
    (spec: Dashboards | undefined) => {
      if (spec) write(spec).catch(report);
    },
    delay,
  );
  const add = (next: Dashboards): Promise<unknown> => {
    flush();
    return write(next);
  };
  return { draft, change, add };
}
