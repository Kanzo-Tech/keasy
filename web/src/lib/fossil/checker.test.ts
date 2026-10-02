import { beforeEach, describe, expect, it, vi } from "vitest";

const openProgram = vi.fn();
vi.mock("client-only", () => ({}));
vi.mock("./host", () => ({ host: {} }));
vi.mock("@fossil-lang/wasm", () => ({ openProgram, initFossilWasm: vi.fn(), providers: vi.fn(), refs: vi.fn() }));

describe("the job program", () => {
  beforeEach(() => openProgram.mockReset());

  it("is opened again after a failed open, never the cached rejection", async () => {
    const { jobProgram } = await import("./checker");
    openProgram.mockRejectedValueOnce(new Error("the wasm did not download"));
    await expect(jobProgram()).rejects.toThrow("the wasm did not download");

    const program = { sources: vi.fn() };
    openProgram.mockResolvedValueOnce(program);
    await expect(jobProgram()).resolves.toBe(program);
    await expect(jobProgram()).resolves.toBe(program);
    expect(openProgram).toHaveBeenCalledTimes(2);
  });
});
