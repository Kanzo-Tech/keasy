import { describe, expect, it, vi } from "vitest";

import { dashboardWrites } from "./dashboard-writes";

/** `useDebouncedCommit`'s `commit` as far as this needs it: it calls `onCommit` synchronously and hands back its answer. */
const committer = (onCommit: () => Promise<unknown>) => () => onCommit();

const refused = new Error("403 graph/forbidden");

describe("dashboardWrites", () => {
  it("reports a failed add exactly once, to the card that awaits it", async () => {
    const report = vi.fn();
    const writes = dashboardWrites(report);
    const commit = committer(() => writes.write(() => Promise.reject(refused)));

    // The card's `onAdd` returns this promise and draws its rejection.
    const added = writes.awaited(commit);
    await expect(added).rejects.toBe(refused);
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a failed edit once, since nobody awaits it", async () => {
    const report = vi.fn();
    const writes = dashboardWrites(report);
    // The pause's commit: its promise is dropped, as `useDebouncedCommit` drops it.
    const written = committer(() => writes.write(() => Promise.reject(refused)))();
    written.catch(() => undefined);
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
    expect(report).toHaveBeenCalledWith(refused);
  });

  it("marks only the add's own commit: an edit after a failed add is still reported", async () => {
    const report = vi.fn();
    const writes = dashboardWrites(report);
    await writes.awaited(committer(() => writes.write(() => Promise.reject(refused)))).catch(() => undefined);
    committer(() => writes.write(() => Promise.reject(refused)))().catch(() => undefined);
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  });
});
