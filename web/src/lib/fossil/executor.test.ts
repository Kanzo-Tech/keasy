// @vitest-environment node
import type { Host, RunReport } from "@fossil-lang/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.fn();
vi.mock("@fossil-lang/executor", () => ({ run }));

const { PREVIEW_ROWS, runInto } = await import("./executor");

const host = {} as Host;
const report = { location: "memory://corpus/", dropped: [] } as unknown as RunReport;

describe("the one door to fossil's run", () => {
  beforeEach(() => run.mockReset());

  it("runs a graph into its job, and answers no files", async () => {
    run.mockResolvedValue(report);
    const signal = new AbortController().signal;
    await expect(runInto("program", { host, into: { job: "g1" }, signal })).resolves.toEqual({ report, files: [] });
    expect(run).toHaveBeenCalledWith("program", { host, into: { job: "g1" }, signal });
  });

  it("runs a preview into memory over the first rows of each source, and answers its files", async () => {
    const files = [{ path: "fossil.json", bytes: new Uint8Array([123, 125]) }];
    run.mockResolvedValue({ report, files });
    const profiled = { descriptors: [], undescribed: [] };
    await expect(runInto("program", { host, into: "memory", profiled: profiled as never })).resolves.toEqual({ report, files });
    expect(run).toHaveBeenCalledWith("program", { host, into: "memory", limit: PREVIEW_ROWS, profiled });
    expect(PREVIEW_ROWS).toBe(200);
  });
});
