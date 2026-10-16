import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import { initSync } from "@kanzo-tech/rudof-wasm";
import { propose, runTask, verify } from "@kanzo-tech/ai/task";
import type { JoinGraph } from "@kanzo-tech/relations";
import { declare, mappingOf } from "./mapping";
import { accept } from "./model";
import { isAnswerable, joinGraphOf, type Requirement, type RequirementsInput, requirements } from "./requirements";
import { DRAFT, NOBEL, scripted } from "./nobel.fixture";

const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : "code"))!;
const XSD = "http://www.w3.org/2001/XMLSchema#";
/** The parts of a JSON Schema a test reads. */
interface Schema {
  properties: Record<string, Schema>;
  items: Schema;
  enum: string[];
}

let graph: JoinGraph;
let input: RequirementsInput;

// The graph is described by the mapping fossil makes of the declared model, read by rudof: both modules, booted from their bytes.
beforeAll(async () => {
  const resolve = createRequire(import.meta.url).resolve;
  await initFossilWasm(readFileSync(resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  initSync({ module: readFileSync(resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm")) });
  const host = { connections: async () => ({}), credentials: async () => [] };
  const { prelude } = await declare(accepted, NOBEL, { base: "https://acme.example/" });
  graph = joinGraphOf(accepted, await mappingOf(prelude, { host }));
  input = { accepted, graph, about: "Nobel prizes" };
});

const byInstitution: Requirement = { text: "Which institutions have the most laureates?", of: "Laureate", fields: ["affiliation.name"] };
const byCountry: Requirement = { text: "How many countries are there?", of: "Country", fields: ["name"] };
// `affiliation` is a link of a laureate's, not of an award's.
const unreachable: Requirement = { text: "Which institution won the most awards?", of: "Award", fields: ["affiliation.name"] };

describe("the requirements Task", () => {
  it("offers the questions Ask's resolver can reach, and drops the rest", async () => {
    const { model, prompts } = scripted({ elements: [byInstitution, unreachable, byCountry] });
    const offered = await propose(requirements, input, { model, count: 5 });
    expect(offered.map((p) => p.value.text)).toEqual([byInstitution.text, byCountry.text]);
    expect(prompts[0]).toContain("Laureate.affiliation links to Institution, several per Laureate");
  });

  it("names why a question cannot be answered: a path it reads does not leave what it counts", async () => {
    const verdict = await verify(requirements, unreachable, input);
    expect(verdict).toEqual({
      ok: false,
      diagnostics: [
        { code: "requirements/unreachable", at: "/fields", message: "Which institution won the most awards?: nothing in these files reaches affiliation.name from Award." },
      ],
    });
  });

  it("closes what a question may read to the accepted model's types and the paths from them", () => {
    const schema = requirements.output!(input, { types: ["Laureate"], paths: { Laureate: ["name", "affiliation.name"] } }) as unknown as {
      jsonSchema: Schema;
    };
    expect(schema.jsonSchema.properties.of.enum).toEqual(["Laureate"]);
    expect(schema.jsonSchema.properties.fields.items.enum).toEqual(["name", "affiliation.name"]);
  });

  it("offers the paths Ask's model writes, a link's and a link's way back among them, and no key", async () => {
    const { paths } = await requirements.context!(input);
    expect(paths.Award).toContain("laureate.affiliation.name");
    expect(paths.Laureate).toContain("^laureate.category");
    expect(Object.values(paths).flat().filter((p) => p === "id" || p.endsWith(".id"))).toEqual([]);
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
    // A two-hop question: awards by their laureate's institution.
    const proposal = await runTask(requirements, input, {
      model: scripted({ text: "Awards by institution?", of: "Award", fields: ["laureate.affiliation.name"] }).model,
    });
    expect(proposal.verdict).toEqual({ ok: true });
  });
});
