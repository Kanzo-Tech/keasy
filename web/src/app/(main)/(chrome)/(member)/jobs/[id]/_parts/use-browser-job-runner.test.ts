import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async () => {
  const { ApiError } = await import("@keasy/api");
  return { ApiError, http: {} };
});
vi.mock("@fossil-lang/corpus", () => ({}));
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
vi.mock("@/lib/errors", () => ({ toastError: vi.fn(), toProblem: vi.fn() }));

const { ApiError } = await import("@keasy/api");
const { lease, LEASE_MS } = await import("./use-browser-job-runner");

/** A clock that `wait` advances, so the retries run without real time passing. */
function clock() {
  let t = 0;
  return { now: () => t, wait: async (ms: number) => void (t += ms) };
}

const down = () => new ApiError({ code: "server/silent", title: "", detail: "", data: {} });

describe("the job's lease", () => {
  it("reports again after a transient failure, and lands", async () => {
    const send = vi.fn().mockRejectedValueOnce(down()).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue("ok");
    await expect(lease("j", clock()).report(send)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up once the lease would have expired, so the sweep owns the job", async () => {
    const c = clock();
    const send = vi.fn().mockRejectedValue(down());
    await expect(lease("j", c).report(send)).rejects.toMatchObject({ code: "server/silent" });
    expect(c.now()).toBeLessThan(LEASE_MS);
    expect(send.mock.calls.length).toBeGreaterThan(3);
  });

  it("does not ask again when the server refused, as for a job the sweep already ended", async () => {
    const ended = new ApiError({ code: "job/not-running", title: "", detail: "", data: {} }, 409);
    const send = vi.fn().mockRejectedValue(ended);
    await expect(lease("j", clock()).report(send)).rejects.toBe(ended);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("heartbeats every 15 s while held, and stops when released", () => {
    vi.useFakeTimers();
    const beat = vi.fn().mockResolvedValue(undefined);
    const held = lease("j", { beat });
    held.hold();
    vi.advanceTimersByTime(45_000);
    expect(beat).toHaveBeenCalledTimes(3);
    held.release();
    vi.advanceTimersByTime(45_000);
    expect(beat).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
