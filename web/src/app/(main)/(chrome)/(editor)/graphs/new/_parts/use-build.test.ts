import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const POST = vi.fn(async (path: string, init: { params?: { path: { id: string } }; body?: unknown }) => {
  calls.push(path);
  return { data: { id: init.params?.path.id ?? "g1", script: "program" } };
});
vi.mock("@/lib/api/client", () => ({ http: { POST, GET: vi.fn() }, invalidate: vi.fn(), connectionsQuery: {} }));
vi.mock("@/lib/api/query-client", () => ({
  queryClient: { fetchQuery: async () => [{ name: "lake", target: { direction: "source" } }, { name: "out", target: { direction: "sink" } }] },
}));
const startRun = vi.fn();
vi.mock("@/app/(main)/(chrome)/graphs/[id]/_parts/use-browser-graph-runner", () => ({ startRun }));
vi.mock("@/lib/api/spec", () => ({ stringRule: () => ({ maxLength: 63 }), stringProblem: () => null }));

const { keasySteps } = await import("./use-build");

describe("keasy's build steps", () => {
  it("make the graph as the studio does — a draft, submitted, run here — in the workspace's sink", async () => {
    const graph = await keasySteps({ name: "Nobel" }).create("program");
    expect(calls).toEqual(["/v1/graphs", "/v1/graphs/{id}/submit", "/v1/graphs/{id}/run"]);
    expect(POST.mock.calls[0]![1].body).toMatchObject({ script: "program", name: "Nobel", sink_connection: "out" });
    expect(graph.id).toBe("g1");
  });

  it("make it with the conversation it was built from", async () => {
    POST.mockClear();
    await keasySteps({ conversation: "c1" }).create("program");
    expect(POST.mock.calls[0]![1].body).toMatchObject({ script: "program", conversation: "c1" });
  });

  it("answer the whole run's problem as theirs", async () => {
    const problem = new Error("over budget");
    startRun.mockResolvedValueOnce({ status: "failed", problem });
    await expect(keasySteps().full({ id: "g1" } as never, undefined)).rejects.toBe(problem);
    startRun.mockResolvedValueOnce({ status: "completed" });
    await expect(keasySteps().full({ id: "g1" } as never, undefined)).resolves.toBeUndefined();
  });
});
