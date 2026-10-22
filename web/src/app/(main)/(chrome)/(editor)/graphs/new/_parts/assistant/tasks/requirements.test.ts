import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync } from "@kanzo-tech/rudof-wasm";
import { type JoinGraph, JoinResolver } from "@kanzo-tech/relations";
import type { Model } from "@fossil-lang/types";
import { infer, initFossilWasm, write } from "@fossil-lang/wasm";
import { mappingOf } from "./mapping";
import { joinGraphOf, offersOf } from "./requirements";
import { PROFILE } from "./nobel.fixture";

const XSD = "http://www.w3.org/2001/XMLSchema#";
let model: Model;
let graph: JoinGraph;

// The graph is described by the mapping fossil makes of the program it writes of the model, read by rudof: both modules, booted from their bytes.
beforeAll(async () => {
  const resolve = createRequire(import.meta.url).resolve;
  await initFossilWasm(readFileSync(resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  initSync({ module: readFileSync(resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm")) });
  const host = { connections: async () => ({}), credentials: async () => [] };
  model = (await infer(PROFILE, { choices: { "count/affiliations": "link" } })).model;
  graph = joinGraphOf(model, await mappingOf(await write(model, { base: "https://acme.example/" }), { host }));
});

describe("the questions on offer", () => {
  const count = (of: string, x: string, top?: number) => ({ of, show: { kind: "chart", type: "bar", x, y: { op: "count" } }, ...(top ? { top } : {}) });

  it("are Ask's specs written from the model: a count by the thing an edge reaches, and a count by a field", async () => {
    expect(await offersOf(model, graph)).toEqual([
      { text: "Awards count by laureate", spec: count("Awards", "laureate.name", 10) },
      { text: "Laureates count by born", spec: count("Laureates", "born") },
      { text: "Awards count by category", spec: count("Awards", "category") },
      { text: "Institutions count by city", spec: count("Institutions", "city") },
    ]);
  });

  it("offer nothing Ask's oracles do not hold", async () => {
    expect(await offersOf(model, { types: [], edges: [] })).toEqual([]);
  });
});

describe("the join graph the model will be", () => {
  it("is described by fossil's mapping of the program written of the model: each type's class, each column's predicate and datatype, each edge's predicate", () => {
    const award = graph.types.find((t) => t.name === "Awards")!;
    expect(award.iri).toBe("https://acme.example/vocab/Awards");
    expect(award.columns).toContainEqual({ name: "year", type: "BIGINT", iri: "https://acme.example/vocab/year", termType: "Literal", datatype: `${XSD}integer` });
    expect(award.columns).toContainEqual({ name: "id", type: "VARCHAR", role: "identity" });
    expect(graph.types.find((t) => t.name === "Laureates")!.columns).toContainEqual(expect.objectContaining({ name: "born", datatype: `${XSD}date` }));
    expect(graph.edges.find((e) => e.label === "institution")!.iri).toBe("https://acme.example/vocab/institution");
  });

  it("has a table per type and one per edge, as Ask joins them", async () => {
    expect(graph.types.map((t) => t.name)).toEqual(["Laureates", "Awards", "Institutions", "Countries"]);
    expect(graph.edges.map((e) => e.name)).toEqual(["Laureates_institution_Institutions", "Awards_laureate_Laureates"]);
    // A two-hop path: awards by their laureate's institution.
    expect(new JoinResolver(graph).field({ root: "Awards", path: [] }, "laureate.institution.name")).not.toHaveProperty("code");
  });
});
