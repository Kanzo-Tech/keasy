import { describe, expect, it } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { primaryAction, type Viewer } from "./graphs";

const graph = (over: Partial<Schemas["Graph"]>): Schemas["Graph"] =>
  ({
    id: "j",
    status: "idle",
    created_at: "",
    created_by: { id: "u-1", name: "Ana" },
    owner: { id: "u-1", name: "Ana" },
    sink_connection: "sink",
    can: { use: true, operate: true, manage: true, transfer: true },
    can_stop: false,
    cancel_requested: false,
    ...over,
  }) as Schemas["Graph"];

const editor: Viewer = { editor: true, me: "u-1", runsHere: false };
const reader: Viewer = { editor: false, me: "u-3", runsHere: false };

describe("the header's primary action", () => {
  it("is the state's next step for whoever may take it", () => {
    expect(primaryAction(graph({ status: "draft" }), editor)).toMatchObject({ kind: "edit" });
    expect(primaryAction(graph({ status: "idle" }), editor)).toMatchObject({ kind: "run" });
    expect(primaryAction(graph({ status: "failed" }), editor)).toMatchObject({ kind: "run-again" });
    expect(primaryAction(graph({ status: "cancelled" }), editor)).toMatchObject({ kind: "run-again" });
    expect(primaryAction(graph({ status: "completed" }), editor)).toMatchObject({ kind: "explore" });
    for (const status of ["draft", "idle", "failed", "completed"] as const) {
      expect(primaryAction(graph({ status }), editor).blocked).toBeUndefined();
    }
  });

  it("shows a reader Explore, disabled until there is output", () => {
    expect(primaryAction(graph({ status: "completed" }), reader)).toMatchObject({ kind: "explore" });
    for (const status of ["draft", "idle", "running", "failed"] as const) {
      expect(primaryAction(graph({ status, can: { use: true, operate: false, manage: false, transfer: false } }), reader)).toMatchObject({
        kind: "explore",
        blocked: "No output yet",
      });
    }
  });

  it("runs another editor's graph, and disables editing their draft with the reason", () => {
    const theirs = { can: { use: true, operate: true, manage: false, transfer: false } };
    expect(primaryAction(graph({ status: "idle", ...theirs }), editor)).toEqual({ kind: "run", label: "Run" });
    expect(primaryAction(graph({ status: "failed", ...theirs }), editor).blocked).toBeUndefined();
    expect(primaryAction(graph({ status: "draft", ...theirs }), editor).blocked).toMatch(/owner \(Ana\), its managers or an admin/);
  });

  it("stops a run here at once, elsewhere if allowed, and recovers one this tab lost", () => {
    const running = graph({ status: "running", runner: { id: "u-1", name: "u-1" }, can_stop: true });
    expect(primaryAction(running, { ...editor, runsHere: true })).toMatchObject({ kind: "stop" });
    expect(primaryAction(running, editor)).toMatchObject({ kind: "recover" });
    const theirs = graph({ status: "running", runner: { id: "u-2", name: "u-2" }, can_stop: false });
    expect(primaryAction(theirs, editor)).toMatchObject({ kind: "stop", blocked: expect.stringMatching(/admin/) });
    const asAdmin = graph({ status: "running", runner: { id: "u-2", name: "u-2" }, can_stop: true, cancel_requested: true });
    expect(primaryAction(asAdmin, editor)).toMatchObject({ kind: "stop", blocked: "Stopping…" });
  });
});
