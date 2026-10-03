import { describe, expect, it } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { primaryAction, type Viewer } from "./jobs";

const job = (over: Partial<Schemas["Job"]>): Schemas["Job"] =>
  ({ id: "j", status: "idle", created_at: "", created_by: "u-1", sink_connection: "sink", can_modify: true, can_stop: false, cancel_requested: false, ...over }) as Schemas["Job"];

const editor: Viewer = { editor: true, me: "u-1", runsHere: false };
const reader: Viewer = { editor: false, me: "u-3", runsHere: false };

describe("the header's primary action", () => {
  it("is the state's next step for whoever may take it", () => {
    expect(primaryAction(job({ status: "draft" }), editor)).toMatchObject({ kind: "edit" });
    expect(primaryAction(job({ status: "idle" }), editor)).toMatchObject({ kind: "run" });
    expect(primaryAction(job({ status: "failed" }), editor)).toMatchObject({ kind: "run-again" });
    expect(primaryAction(job({ status: "cancelled" }), editor)).toMatchObject({ kind: "run-again" });
    expect(primaryAction(job({ status: "completed" }), editor)).toMatchObject({ kind: "explore" });
    for (const status of ["draft", "idle", "failed", "completed"] as const) {
      expect(primaryAction(job({ status }), editor).blocked).toBeUndefined();
    }
  });

  it("shows a reader Explore, disabled until there is output", () => {
    expect(primaryAction(job({ status: "completed" }), reader)).toMatchObject({ kind: "explore" });
    for (const status of ["draft", "idle", "running", "failed"] as const) {
      expect(primaryAction(job({ status, can_modify: false }), reader)).toMatchObject({ kind: "explore", blocked: "No output yet" });
    }
  });

  it("disables, with the reason, what another editor's graph does not let them do", () => {
    expect(primaryAction(job({ status: "idle", can_modify: false }), editor).blocked).toMatch(/creator or an admin/);
  });

  it("stops a run here at once, elsewhere if allowed, and recovers one this tab lost", () => {
    const running = job({ status: "running", runner: "u-1", can_stop: true });
    expect(primaryAction(running, { ...editor, runsHere: true })).toMatchObject({ kind: "stop" });
    expect(primaryAction(running, editor)).toMatchObject({ kind: "recover" });
    const theirs = job({ status: "running", runner: "u-2", can_stop: false });
    expect(primaryAction(theirs, editor)).toMatchObject({ kind: "stop", blocked: expect.stringMatching(/admin/) });
    const asAdmin = job({ status: "running", runner: "u-2", can_stop: true, cancel_requested: true });
    expect(primaryAction(asAdmin, editor)).toMatchObject({ kind: "stop", blocked: "Stopping…" });
  });
});
