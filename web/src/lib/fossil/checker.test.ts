import { beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
vi.mock("client-only", () => ({}));
vi.mock("./host", () => ({ host: {} }));
vi.mock("@fossil-lang/wasm", () => ({ open, formats: vi.fn() }));

describe("the graph program", () => {
  beforeEach(() => open.mockReset());

  it("is opened again after a failed open, never the cached rejection", async () => {
    const { graphProgram } = await import("./checker");
    open.mockRejectedValueOnce(new Error("the wasm did not download"));
    await expect(graphProgram()).rejects.toThrow("the wasm did not download");

    const program = { inputs: vi.fn() };
    open.mockResolvedValueOnce(program);
    await expect(graphProgram()).resolves.toBe(program);
    await expect(graphProgram()).resolves.toBe(program);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
