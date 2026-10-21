import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import { initSync } from "@kanzo-tech/rudof-wasm";
import { type JoinGraph, JoinResolver } from "@kanzo-tech/relations";
import { declare, mappingOf } from "./mapping";
import { accept } from "./model";
import { joinGraphOf, offersOf } from "./requirements";
import { DRAFT, NOBEL } from "./nobel.fixture";

const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : "code"))!;
const XSD = "http://www.w3.org/2001/XMLSchema#";
let graph: JoinGraph;

// The graph is described by the mapping fossil makes of the declared model, read by rudof: both modules, booted from their bytes.
beforeAll(async () => {
  const resolve = createRequire(import.meta.url).resolve;
  await initFossilWasm(readFileSync(resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  initSync({ module: readFileSync(resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm")) });
  const host = { connections: async () => ({}), credentials: async () => [] };
  const { prelude } = await declare(accepted, NOBEL, { base: "https://acme.example/" });
  graph = joinGraphOf(accepted, await mappingOf(prelude, { host }));
});

describe("the questions on offer", () => {
  const count = (of: string, x: string, top?: number) => ({ of, show: { kind: "chart", type: "bar", x, y: { op: "count" } }, ...(top ? { top } : {}) });

  it("are Ask's specs written from the model: a count by the thing an edge reaches, and a count by a field", async () => {
    expect(await offersOf(accepted, graph)).toEqual([
      { text: "Award count by laureate", spec: count("Award", "laureate.name", 10) },
      { text: "Laureate count by born", spec: count("Laureate", "born") },
      { text: "Award count by category", spec: count("Award", "category") },
      { text: "Institution count by city", spec: count("Institution", "city") },
    ]);
  });

  it("offer nothing Ask's oracles do not hold", async () => {
    expect(await offersOf(accepted, { types: [], edges: [] })).toEqual([]);
  });
});

describe("the join graph the accepted model will be", () => {
  it("is described by fossil's mapping of the declared model: each type's class, each column's predicate and datatype, each edge's predicate", () => {
    const award = graph.types.find((t) => t.name === "Award")!;
    expect(award.iri).toBe("https://acme.example/vocab/Award");
    expect(award.columns).toContainEqual({ name: "year", type: "BIGINT", iri: "https://acme.example/vocab/year", termType: "Literal", datatype: `${XSD}integer` });
    expect(award.columns).toContainEqual({ name: "id", type: "VARCHAR", role: "identity" });
    expect(graph.types.find((t) => t.name === "Laureate")!.columns).toContainEqual(expect.objectContaining({ name: "born", datatype: `${XSD}date` }));
    expect(graph.edges.find((e) => e.label === "affiliation")!.iri).toBe("https://acme.example/vocab/affiliation");
  });

  it("has a table per type and one per edge, as Ask joins them", async () => {
    expect(graph.types.map((t) => t.name)).toEqual(["Laureate", "Award", "Institution", "Country"]);
    expect(graph.edges.map((e) => e.name)).toEqual(["Award_laureate_Laureate", "Laureate_affiliation_Institution"]);
    // A two-hop path: awards by their laureate's institution.
    expect(new JoinResolver(graph).field({ root: "Award", path: [] }, "laureate.affiliation.name")).not.toHaveProperty("code");
  });
});
