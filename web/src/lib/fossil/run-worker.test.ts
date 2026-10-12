// @vitest-environment node
import { FossilError, isFossilError, type Host, type RunReport } from "@fossil-lang/types";
import { describe, expect, it, vi } from "vitest";

import { runOver, serveRun } from "./run-worker";

const REPORT = { location: "s3://lake/jobs/j/", dropped: [] } as unknown as RunReport;

/** Two ends of one channel: the page's and the worker's. */
function channel() {
  const { port1, port2 } = new MessageChannel();
  return { page: port1, worker: port2 };
}

const host = (): Host => ({
  connections: vi.fn(async () => ({ lake: "s3://lake/" })),
  credentials: vi.fn(async () => [{ prefix: "s3://lake/", config: {} }]),
});

describe("a run in a worker", () => {
  it("answers the run's report, the worker's host asking the page's", async () => {
    const { page, worker } = channel();
    serveRun(worker, async (_program, { host: proxied, job, signal }) => {
      expect(await proxied.connections({ signal })).toEqual({ lake: "s3://lake/" });
      await proxied.credentials({ job }, "write", { signal });
      return REPORT;
    });
    const real = host();
    await expect(runOver(page, "program", { host: real, job: "j" })).resolves.toEqual(REPORT);
    expect(real.credentials).toHaveBeenCalledWith({ job: "j" }, "write", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    page.close();
  });

  it("rejects with the run's FossilError, rebuilt on the page's side", async () => {
    const { page, worker } = channel();
    serveRun(worker, async () => {
      throw FossilError.of("internal/bug", { what: "a panic" });
    });
    const failed = await runOver(page, "program", { host: host(), job: "j" }).catch((error: unknown) => error);
    expect(isFossilError(failed, "internal/bug")).toBe(true);
    page.close();
  });

  it("carries a host's refusal into the worker as the FossilError it was", async () => {
    const { page, worker } = channel();
    serveRun(worker, async (_program, { host: proxied, job, signal }) => proxied.credentials({ job }, "write", { signal }).then(() => REPORT));
    const refusing: Host = { ...host(), credentials: async () => Promise.reject(FossilError.of("internal/bug", { what: "no grant" })) };
    const failed = await runOver(page, "program", { host: refusing, job: "j" }).catch((error: unknown) => error);
    expect(isFossilError(failed, "internal/bug")).toBe(true);
    page.close();
  });

  it("stops the run when the page's signal aborts, rejecting with its reason", async () => {
    const { page, worker } = channel();
    serveRun(
      worker,
      (_program, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const stop = new AbortController();
    const running = runOver(page, "program", { host: host(), job: "j", signal: stop.signal });
    const reason = new DOMException("Stopped", "AbortError");
    stop.abort(reason);
    await expect(running).rejects.toBe(reason);
    page.close();
  });
});
