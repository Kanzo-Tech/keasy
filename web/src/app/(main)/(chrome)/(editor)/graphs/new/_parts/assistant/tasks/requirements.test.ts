import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import { initSync } from "@kanzo-tech/rudof-wasm";
import { type JoinGraph, JoinResolver } from "@kanzo-tech/relations";
import { declare, mappingOf } from "./mapping";
import { accept } from "./model";
import { isAnswerable, joinGraphOf, offersOf } from "./requirements";
import { DRAFT, NOBEL, scripted } from "./nobel.fixture";

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
  it("are written from the model: the thing an edge reaches most, and a count by a field", () => {
    expect(offersOf(accepted, graph)).toEqual([
      { text: "Which laureate has the most awards?", of: "Award", fields: ["laureate.name"] },
      { text: "How many laureates are there by born?", of: "Laureate", fields: ["born"] },
      { text: "How many awards are there by category?", of: "Award", fields: ["category"] },
      { text: "How many institutions are there by city?", of: "Institution", fields: ["city"] },
    ]);
  });

  it("offer nothing Ask's resolver cannot reach", () => {
    expect(offersOf(accepted, { types: [], edges: [] })).toEqual([]);
  });
});

describe("a question the person typed", () => {
  it("is answerable when Ask's spec holds", async () => {
    const spec = { of: "Award", show: { kind: "chart", type: "bar", x: "category", y: { op: "count" } } };
    expect(await isAnswerable("Prizes by category?", graph, { model: scripted({ spec }).model })).toBe(true);
  });

  it("is not when Ask cannot reach what it reads, after Ask's own repairs", async () => {
    const spec = { of: "Award", show: { kind: "chart", type: "bar", x: "country.name", y: { op: "count" } } };
    const { model, prompts } = scripted({ spec });
    expect(await isAnswerable("Prizes by country?", graph, { model })).toBe(false);
    expect(prompts).toHaveLength(3);
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
