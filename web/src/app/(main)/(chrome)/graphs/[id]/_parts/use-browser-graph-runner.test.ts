import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/client", async () => {
  const { ApiError } = await import("@keasy/api");
  return { ApiError, http: {}, invalidate: vi.fn() };
});
vi.mock("@fossil-lang/corpus", () => ({}));
vi.mock("@/lib/fossil/host", () => ({ host: {} }));
vi.mock("@/lib/errors", () => ({ toastError: vi.fn(), wireOf: vi.fn() }));

const { ApiError } = await import("@keasy/api");
const { lease, LEASE_MS } = await import("./use-browser-graph-runner");

/** A clock that `wait` advances, so the retries run without real time passing. */
function clock() {
  let t = 0;
  return { now: () => t, wait: async (ms: number) => void (t += ms) };
}

const down = () => new ApiError({ code: "server/silent", title: "", detail: "", data: {} });

describe("the graph's lease", () => {
  it("reports again after a transient failure, and lands", async () => {
    const send = vi.fn().mockRejectedValueOnce(down()).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue("ok");
    await expect(lease("j", clock()).report(send)).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("gives up once the lease would have expired, so the sweep owns the graph", async () => {
    const c = clock();
    const send = vi.fn().mockRejectedValue(down());
    await expect(lease("j", c).report(send)).rejects.toMatchObject({ code: "server/silent" });
    expect(c.now()).toBeLessThan(LEASE_MS);
    expect(send.mock.calls.length).toBeGreaterThan(3);
  });

  it("does not ask again when the server refused, as for a graph the sweep already ended", async () => {
    const ended = new ApiError({ code: "graph/ended", title: "", detail: "", data: {} }, 409);
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

  it("hears a stop asked from anywhere in the answer to a beat", async () => {
    vi.useFakeTimers();
    const onStopAsked = vi.fn();
    const beat = vi.fn().mockResolvedValueOnce({ cancel_requested: false }).mockResolvedValue({ cancel_requested: true });
    const held = lease("j", { beat, onStopAsked });
    held.hold();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onStopAsked).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onStopAsked).toHaveBeenCalledTimes(1);
    held.release();
    vi.useRealTimers();
  });
});
