// @vitest-environment node
import { FossilError, isFossilError, type Host, type Profiled, type RunReport } from "@fossil-lang/types";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@keasy/api";

import { runOver, serveRun } from "./run-worker";

const REPORT = { location: "s3://lake/jobs/j/", dropped: [] } as unknown as RunReport;
const RAN = { report: REPORT, files: [] };

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
    serveRun(worker, async (_program, { host: proxied, into, signal }) => {
      expect(await proxied.connections({ signal })).toEqual({ lake: "s3://lake/" });
      await proxied.credentials(into as { job: string }, "write", { signal });
      return RAN;
    });
    const real = host();
    await expect(runOver(page, "program", { host: real, into: { job: "j" } })).resolves.toEqual(RAN);
    expect(real.credentials).toHaveBeenCalledWith({ job: "j" }, "write", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    page.close();
  });

  it("answers a run into memory with the corpus's files, their bytes whole", async () => {
    const { page, worker } = channel();
    let asked: unknown;
    serveRun(worker, async (_program, { into }) => {
      asked = into;
      return { report: REPORT, files: [{ path: "fossil.json", bytes: new TextEncoder().encode("{}") }, { path: "vertex/Person.parquet", bytes: new Uint8Array([1, 2, 3]) }] };
    });
    const ran = await runOver(page, "program", { host: host(), into: "memory" });
    expect(asked).toBe("memory");
    expect(ran.files.map((f) => [f.path, [...f.bytes]])).toEqual([
      ["fossil.json", [123, 125]],
      ["vertex/Person.parquet", [1, 2, 3]],
    ]);
    page.close();
  });

  it("hands the run what the profile answered", async () => {
    const { page, worker } = channel();
    const profiled = { descriptors: [], undescribed: [] } as unknown as Profiled;
    let seen: Profiled | undefined;
    serveRun(worker, async (_program, options) => {
      seen = options.profiled;
      return RAN;
    });
    await runOver(page, "program", { host: host(), into: { job: "j" }, profiled });
    expect(seen).toEqual(profiled);
    page.close();
  });

  it("rejects with the run's FossilError, rebuilt on the page's side", async () => {
    const { page, worker } = channel();
    serveRun(worker, async () => {
      throw FossilError.of("internal/bug", { what: "a panic" });
    });
    const failed = await runOver(page, "program", { host: host(), into: { job: "j" } }).catch((error: unknown) => error);
    expect(isFossilError(failed, "internal/bug")).toBe(true);
    page.close();
  });

  it("carries a host's refusal into the worker as the FossilError it was", async () => {
    const { page, worker } = channel();
    serveRun(worker, async (_program, { host: proxied, into, signal }) => proxied.credentials(into as { job: string }, "write", { signal }).then(() => RAN));
    const refusing: Host = { ...host(), credentials: async () => Promise.reject(FossilError.of("internal/bug", { what: "no grant" })) };
    const failed = await runOver(page, "program", { host: refusing, into: { job: "j" } }).catch((error: unknown) => error);
    expect(isFossilError(failed, "internal/bug")).toBe(true);
    page.close();
  });

  it("rebuilds a FossilError thrown in the worker with its code and data", async () => {
    const { page, worker } = channel();
    serveRun(worker, async () => {
      throw FossilError.of("document/unread", { documents: ["@lake/people.shex"] });
    });
    const failed = await runOver(page, "program", { host: host(), into: { job: "j" } }).catch((error: unknown) => error);
    expect(isFossilError(failed, "document/unread")).toBe(true);
    expect((failed as FossilError).problem.data).toEqual({ documents: ["@lake/people.shex"] });
    page.close();
  });

  // fossil reads a host refusal's `code` and `data` off whatever it is rejected with, and names it
  // as the cause of the run's problem: keasy's `store/refused` must reach it with its code.
  it("carries a host's ApiError into the worker with its code, title and data", async () => {
    const { page, worker } = channel();
    let seen: unknown;
    serveRun(worker, async (_program, { host: proxied, into, signal }) => {
      try {
        await proxied.credentials(into as { job: string }, "write", { signal });
      } catch (error) {
        seen = error;
      }
      return RAN;
    });
    const refusal = new ApiError(
      { code: "store/refused", title: "The store refused to vend a credential", detail: "AccessDenied", data: { field: "lake" } },
      502,
    );
    const refusing: Host = { ...host(), credentials: async () => Promise.reject(refusal) };
    await runOver(page, "program", { host: refusing, into: { job: "j" } });
    expect(seen).toBeInstanceOf(Error);
    expect(seen).toMatchObject({
      name: "ApiError",
      message: "AccessDenied",
      code: "store/refused",
      title: "The store refused to vend a credential",
      data: { field: "lake" },
    });
    page.close();
  });

  it("stops the run when the page's signal aborts, rejecting with its reason", async () => {
    const { page, worker } = channel();
    serveRun(
      worker,
      (_program, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const stop = new AbortController();
    const running = runOver(page, "program", { host: host(), into: { job: "j" }, signal: stop.signal });
    const reason = new DOMException("Stopped", "AbortError");
    stop.abort(reason);
    await expect(running).rejects.toBe(reason);
    page.close();
  });
});
