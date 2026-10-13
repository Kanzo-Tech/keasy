import { describe, expect, it } from "vitest";
import { propose, runTask, verify } from "@kanzo-tech/ai/task";
import { accept } from "./model";
import { askInputOf, isAnswerable, joinGraphOf, type Requirement, requirements } from "./requirements";
import { DRAFT, NOBEL, scripted } from "./nobel.fixture";

const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : "code"))!;
/** The parts of a JSON Schema a test reads. */
interface Schema {
  properties: Record<string, Schema>;
  items: Schema;
  enum: string[];
}

const input = { accepted, about: "Nobel prizes" };

const byInstitution: Requirement = { text: "Which institutions have the most laureates?", of: "Laureate", fields: ["Institution.name"] };
const byCountry: Requirement = { text: "How many countries are there?", of: "Country", fields: ["Country.name"] };
const unreachable: Requirement = { text: "Which country won the most awards?", of: "Award", fields: ["Country.name"] };

describe("the requirements Task", () => {
  it("offers the questions Ask's resolver can reach, and drops the rest", async () => {
    const { model, prompts } = scripted({ elements: [byInstitution, unreachable, byCountry] });
    const offered = await propose(requirements, input, { model, count: 5 });
    expect(offered.map((p) => p.value.text)).toEqual([byInstitution.text, byCountry.text]);
    expect(prompts[0]).toContain("Laureate.affiliation links to Institution, several per Laureate");
  });

  it("names why a question cannot be answered: nothing links what it counts to what it reads", async () => {
    const verdict = await verify(requirements, unreachable, input);
    expect(verdict).toEqual({
      ok: false,
      diagnostics: [{ code: "requirements/unreachable", at: "/of", message: "Which country won the most awards?: nothing links Award to Country in these files." }],
    });
  });

  it("closes what a question may read to the accepted model's types and fields", () => {
    const schema = requirements.output!(input, { types: ["Laureate"], fields: ["Laureate.name"] }) as unknown as { jsonSchema: Schema };
    expect(schema.jsonSchema.properties.of.enum).toEqual(["Laureate"]);
    expect(schema.jsonSchema.properties.fields.items.enum).toEqual(["Laureate.name"]);
  });
});

describe("a question the person typed", () => {
  it("is put to Ask over the accepted model, its fields the profile's", () => {
    const asked = askInputOf("Prizes by category?", accepted, NOBEL);
    expect(asked.graph).toEqual(joinGraphOf(accepted));
    const award = asked.types.find((t) => t.relation.root === "Award")!;
    expect(award.fields.find((f) => f.name === "Award.category")).toMatchObject({ kind: "categorical", values: ["Physics", "Chemistry"] });
    expect(award.fields.find((f) => f.name === "Award.share")).toMatchObject({ kind: "numeric", role: "measure" });
  });

  it("is answerable when Ask's spec holds", async () => {
    const spec = { of: "Award", show: { kind: "chart", type: "bar", x: "Award.category", y: { op: "count" } } };
    expect(await isAnswerable("Prizes by category?", accepted, NOBEL, { model: scripted(spec).model })).toBe(true);
  });

  it("is not when Ask cannot reach what it reads, after Ask's own repairs", async () => {
    const spec = { of: "Award", show: { kind: "chart", type: "bar", x: "Country.name", y: { op: "count" } } };
    const { model, prompts } = scripted(spec);
    expect(await isAnswerable("Prizes by country?", accepted, NOBEL, { model })).toBe(false);
    expect(prompts).toHaveLength(3);
  });
});

describe("the join graph the accepted model will be", () => {
  it("has a table per type and one per edge, as Ask joins them", async () => {
    const graph = joinGraphOf(accepted);
    expect(graph.types.map((t) => t.name)).toEqual(["Laureate", "Award", "Institution", "Country"]);
    expect(graph.edges.map((e) => e.name)).toEqual(["Award_laureate_Laureate", "Laureate_affiliation_Institution"]);
    // A two-hop question: awards by their laureate's institution.
    const proposal = await runTask(requirements, input, {
      model: scripted({ text: "Awards by institution?", of: "Award", fields: ["Institution.name"] }).model,
    });
    expect(proposal.verdict).toEqual({ ok: true });
  });
});
