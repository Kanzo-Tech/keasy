// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboards } from "@kanzo-tech/ui/analytics";

import { useDashboardWrites, type DashboardWritesOptions } from "./dashboard-writes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DELAY = 800;
const stored: Dashboards = { byRelation: {} };
const edited: Dashboards = { byRelation: { Person: { tiles: [] } } } as unknown as Dashboards;
const withTile: Dashboards = { byRelation: { Person: { tiles: [{ id: "t" }] } } } as unknown as Dashboards;
const refused = new Error("403 graph/forbidden");

/** The hook mounted as the store mounts it, with `write` and `report` the test's. */
function mount(write: DashboardWritesOptions["write"]) {
  const report = vi.fn();
  const writesRef: { current: ReturnType<typeof useDashboardWrites> | null } = { current: null };
  function Harness() {
    const writes = useDashboardWrites(stored, { write, report, delay: DELAY });
    // Handed out after the commit, as a ref is, so the test calls what the store would call.
    useEffect(() => {
      writesRef.current = writes;
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  mounted.push(root);
  return { report, writes: () => writesRef.current! };
}

const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  vi.useRealTimers();
});

describe("useDashboardWrites", () => {
  it("a failed add rejects to the card only", async () => {
    const { report, writes } = mount(() => Promise.reject(refused));
    await expect(writes().add(withTile)).rejects.toBe(refused);
    expect(report).not.toHaveBeenCalled();
  });

  it("a failed edit is reported once", async () => {
    vi.useFakeTimers();
    const write = vi.fn(() => Promise.reject(refused));
    const { report, writes } = mount(write);
    act(() => writes().change(edited));
    expect(write).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(DELAY));
    expect(write).toHaveBeenCalledWith(edited);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(refused);
  });

  it("an add during a pending edit writes the edit first, then the add, and the pause writes nothing more", async () => {
    vi.useFakeTimers();
    const write = vi.fn<(spec: Dashboards) => Promise<void>>(() => Promise.resolve());
    const { writes } = mount(write);
    act(() => writes().change(edited));
    await act(async () => void (await writes().add(withTile)));
    expect(write.mock.calls.map(([spec]) => spec)).toEqual([edited, withTile]);
    await act(async () => vi.advanceTimersByTime(DELAY));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("an edit after a failed add is reported", async () => {
    vi.useFakeTimers();
    const { report, writes } = mount(() => Promise.reject(refused));
    await act(async () => void (await writes().add(withTile).catch(() => undefined)));
    act(() => writes().change(edited));
    await act(async () => vi.advanceTimersByTime(DELAY));
    expect(report).toHaveBeenCalledTimes(1);
  });
});
