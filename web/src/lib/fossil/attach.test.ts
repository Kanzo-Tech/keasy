// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **A graph is attached as GraphAr, and given back whole.** The views and the five `graphar_*`
 * relations are `attachGraph`'s (held against a real run in the graphar and fossil repositories); what
 * is keasy's is the composition around it — where each file is read from, what the attach takes besides
 * the catalog, and what a refusal is called.
 */

class GraphArError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const attachGraph = vi.fn();
vi.mock("@kanzo-tech/graphar-duckdb", () => ({ attachGraph, GraphArError }));
vi.mock("@/lib/errors", () => ({
  ClientError: class extends Error {
    constructor(
      readonly code: string,
      readonly title: string,
      detail: string,
      options?: ErrorOptions,
    ) {
      super(detail, options);
    }
  },
}));
const mount = vi.fn();
vi.mock("@fossil-lang/storage", () => ({ mount }));

const { attachFiles, attachJob, GRAPH_ENTRY, MAPPING_FILE } = await import("./attach");

const signal = new AbortController().signal;
const text = (s: string) => new TextEncoder().encode(s);

/** An engine that records the files registered with it. */
function engine() {
  const registered: string[] = [];
  return {
    registered,
    query: vi.fn(),
    registerFileBuffer: vi.fn(async (name: string) => void registered.push(name)),
    dropFiles: vi.fn(async (names: readonly string[]) => void names.forEach((n) => registered.splice(registered.indexOf(n), 1))),
  };
}

beforeEach(() => {
  attachGraph.mockReset();
  mount.mockReset();
  attachGraph.mockResolvedValue({ detach: vi.fn(async () => {}) });
});

describe("a run's files, attached from memory", () => {
  const files = [
    { path: GRAPH_ENTRY, bytes: text("name: fossil") },
    { path: MAPPING_FILE, bytes: text("<#Person> a rml:TriplesMap .") },
  ];

  it("registers each file the attach asks for under a prefix of its own, and gives them back on detach", async () => {
    const e = engine();
    const graph = await attachFiles("preview-1", { engine: e as never, files, signal });
    expect(attachGraph).toHaveBeenCalledWith(e, "preview-1", expect.any(Function), expect.objectContaining({ entry: GRAPH_ENTRY }));
    const resolve = attachGraph.mock.calls[0]![2] as (paths: string[]) => Promise<string[]>;
    const [named] = await resolve([GRAPH_ENTRY]);
    expect(named).toMatch(/^fossil-memory\/\d+\/fossil\.graph\.yml$/);
    expect(await resolve([GRAPH_ENTRY])).toEqual([named]);
    expect(e.registered).toEqual([named]);
    await graph.detach();
    await graph.detach();
    expect(e.registered).toEqual([]);
    expect(e.dropFiles).toHaveBeenCalledTimes(1);
  });

  it("does not take the files of the attachment it replaces: a second attach under one name has a prefix of its own", async () => {
    const e = engine();
    await attachFiles("preview-1", { engine: e as never, files });
    await attachFiles("preview-1", { engine: e as never, files });
    const [one, two] = attachGraph.mock.calls.map(([, , resolve]) => resolve as (paths: string[]) => Promise<string[]>);
    expect((await one!([GRAPH_ENTRY]))[0]).not.toBe((await two!([GRAPH_ENTRY]))[0]);
  });

  it("reads mapping.ttl from the bytes in hand", async () => {
    const graph = await attachFiles("preview-1", { engine: engine() as never, files });
    await expect(graph.mapping({ signal })).resolves.toBe("<#Person> a rml:TriplesMap .");
  });

  it("says which file the run did not write", async () => {
    const graph = await attachFiles("preview-1", { engine: engine() as never, files: [files[0]!] });
    await expect(graph.mapping({ signal })).rejects.toThrow("mapping.ttl");
  });

  it("is a graph/unreadable when the files do not read as GraphAr, and gives back what it registered", async () => {
    attachGraph.mockImplementationOnce(async (_e, _name, resolve: (paths: string[]) => Promise<string[]>) => {
      await resolve([GRAPH_ENTRY]);
      throw new GraphArError("invalid", "fossil.graph.yml: a version other than gar/v1");
    });
    const e = engine();
    await expect(attachFiles("preview-1", { engine: e as never, files, signal })).rejects.toMatchObject({
      code: "graph/unreadable",
      message: "fossil.graph.yml: a version other than gar/v1",
      cause: expect.any(GraphArError),
    });
    expect(e.registered).toEqual([]);
  });
});

describe("a job's graph, attached under its credential", () => {
  const mounted = (prefixes: string[]) => ({
    prefixes,
    files: vi.fn(async (locations: string[]) => locations.map((l) => `lent:${l}`)),
    close: vi.fn(async () => {}),
  });

  it("reads each file at the one prefix the host vended, and releases the credential on detach", async () => {
    const m = mounted(["s3://lake/out/g1/"]);
    mount.mockResolvedValue(m);
    const graph = await attachJob("g1", { engine: engine() as never, host: {} as never, signal });
    expect(mount).toHaveBeenCalledWith(expect.anything(), {}, { job: "g1" }, "read", { signal });
    const resolve = attachGraph.mock.calls[0]![2] as (paths: string[]) => Promise<string[]>;
    expect(await resolve([GRAPH_ENTRY, "vertex/Person/vertex_count"])).toEqual([
      "lent:s3://lake/out/g1/fossil.graph.yml",
      "lent:s3://lake/out/g1/vertex/Person/vertex_count",
    ]);
    await graph.detach();
    expect(m.close).toHaveBeenCalledTimes(1);
  });

  it("refuses a job vended more than one prefix, and releases what it mounted", async () => {
    const m = mounted(["s3://a/", "s3://b/"]);
    mount.mockResolvedValue(m);
    await expect(attachJob("g1", { engine: engine() as never, host: {} as never })).rejects.toMatchObject({ code: "storage/ambiguous-prefix" });
    expect(m.close).toHaveBeenCalledTimes(1);
    expect(attachGraph).not.toHaveBeenCalled();
  });

  it("releases the credential when the graph does not attach", async () => {
    const m = mounted(["s3://lake/out/g1/"]);
    mount.mockResolvedValue(m);
    attachGraph.mockRejectedValueOnce(new GraphArError("unreadable", "fossil.graph.yml did not read"));
    await expect(attachJob("g1", { engine: engine() as never, host: {} as never })).rejects.toMatchObject({ code: "graph/unreadable" });
    expect(m.close).toHaveBeenCalledTimes(1);
  });
});
