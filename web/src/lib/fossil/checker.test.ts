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

describe("a check that never answered", () => {
  it("is one error row on the first character, under fossil's own code", async () => {
    const { FossilError } = await import("@fossil-lang/types");
    const { uncheckedRow, JOB_URI } = await import("./checker");
    const row = uncheckedRow(FossilError.of("api/busy", {} as never));
    expect(row).toMatchObject({
      uri: JOB_URI,
      severity: 1,
      code: "api/busy",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    });
  });

  it("is internal/bug when fossil did not raise it, as the editor's linter shows it", async () => {
    const { uncheckedRow } = await import("./checker");
    const row = uncheckedRow(new Error("the wasm did not download"));
    expect(row.code).toBe("internal/bug");
    expect(row.severity).toBe(1);
  });
});
