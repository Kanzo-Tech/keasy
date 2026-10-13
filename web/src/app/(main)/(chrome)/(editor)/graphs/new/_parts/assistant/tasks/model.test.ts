import { describe, expect, it } from "vitest";
import { runTask, verify } from "@kanzo-tech/ai/task";
import { accept, type Draft, decisionsOf, modelTask, relationsOf } from "./model";
import { DRAFT, NOBEL, scripted } from "./nobel.fixture";

/** The parts of a JSON Schema a test reads. */
interface Schema {
  properties: Record<string, Schema>;
  items: Schema;
  enum: string[];
}

const input = { profiled: NOBEL, about: "Nobel prizes and the people who won them" };
const task = modelTask(NOBEL);

/** The draft with `change` made to a copy of it. */
const changed = (change: (d: Draft) => void): Draft => {
  const copy = structuredClone(DRAFT);
  change(copy);
  return copy;
};

const codes = async (draft: Draft) => {
  const verdict = await verify(task, draft, input);
  return "diagnostics" in verdict ? verdict.diagnostics.map((d) => d.code) : [];
};

describe("the model Task's context and contract", () => {
  it("shows the model every file with its columns, keys and real rows, and every inclusion", async () => {
    const { model, prompts } = scripted(DRAFT);
    await runTask(task, input, { model });
    expect(prompts[0]).toContain("Nobel prizes and the people who won them");
    expect(prompts[0]).toContain("laureates (3 rows): id (integer), name (string), gender (string), born (date)");
    expect(prompts[0]).toContain("candidate keys: id, name");
    expect(prompts[0]).toContain("e.g. 1 · Marie Curie · female · 1867-11-07");
    expect(prompts[0]).toContain("affiliations.institution_id → institutions.id");
  });

  it("closes every file, column and inclusion to the profile's in the schema", () => {
    const schema = task.output!(input, NOBEL) as unknown as { jsonSchema: Schema };
    const type = schema.jsonSchema.properties.types.items;
    expect(type.properties.source.enum).toEqual(["laureates", "awards", "institutions", "affiliations", "countries"]);
    expect(type.properties.key.enum).toContain("laureate_id");
    expect(schema.jsonSchema.properties.edges.items.properties.via.enum).toHaveLength(3);
  });
});

describe("the model Task's oracles", () => {
  it("accept a draft that holds, assuming a key where the profile has two", async () => {
    const proposal = await runTask(task, input, { model: scripted(DRAFT).model });
    // The affiliations file links laureates to institutions: how that counts is the person's.
    expect(proposal.verdict).toMatchObject({ ok: false, decision: { id: "count/affiliations" } });
    expect(proposal.attempts).toBe(1);
  });

  it("refuse a field whose column is another file's", async () => {
    expect(await codes(changed((d) => d.types[0]!.fields.push({ name: "year", column: "year" })))).toEqual(["model/foreign-column"]);
  });

  it("refuse a key that is not unique in the profile", async () => {
    expect(await codes(changed((d) => (d.types[1]!.key = "category")))).toContain("model/not-a-key");
  });

  it("refuse an edge no inclusion backs", async () => {
    // awards.laureate_id lands on laureates, not on institutions.
    expect(await codes(changed((d) => (d.edges[0]!.to = "Institution")))).toEqual(["model/unbacked-edge"]);
  });

  it("refuse an edge to a type the draft does not have", async () => {
    expect(await codes(changed((d) => (d.edges[0]!.to = "Prize")))).toEqual(["model/unknown-type"]);
  });

  it("refuse two types of one name, and a field named as a word of Fossil", async () => {
    expect(await codes(changed((d) => (d.types[3]!.name = "Award")))).toContain("model/duplicate-name");
    expect(await codes(changed((d) => (d.types[2]!.fields[1]!.name = "from")))).toEqual(["model/duplicate-name"]);
  });

  it("send what they refused back, and take the repair", async () => {
    const wrong = changed((d) => (d.types[1]!.key = "category"));
    const { model, prompts } = scripted(wrong, DRAFT);
    const proposal = await runTask(task, input, { model });
    expect(proposal.attempts).toBe(2);
    expect(prompts[1]).toContain("/types/1/key: Award: category does not identify a row of awards; its candidate keys are id.");
  });

  it("give up after three attempts, with the diagnostics as the answer", async () => {
    const { model, prompts } = scripted(changed((d) => (d.types[1]!.key = "category")));
    const proposal = await runTask(task, input, { model });
    expect(prompts).toHaveLength(3);
    expect(proposal.verdict).toMatchObject({ ok: false, diagnostics: [{ code: "model/not-a-key" }] });
  });
});

describe("the decisions a draft raises", () => {
  it("are the key of a thing nothing points at, assumed, and a link file's count, which blocks", () => {
    const decisions = decisionsOf(DRAFT, NOBEL);
    expect(decisions.map((d) => d.id)).toEqual(["key/countries", "count/affiliations"]);
    expect(decisions[0]!.options.map((o) => o.id)).toEqual(["code", "name"]);
    expect(modelTask(NOBEL).decide).toEqual({ "key/laureates": { assume: "id" }, "key/countries": { assume: "code" } });
  });

  it("raise no key decision for a thing an edge lands on: the edge fixes its key", () => {
    expect(decisionsOf(DRAFT, NOBEL).some((d) => d.id === "key/laureates")).toBe(false);
  });

  it("are settled, without a model, once the person picks", async () => {
    const verdict = await verify({ ...task, decide: { ...task.decide, "count/affiliations": { assume: "link" } } }, DRAFT, input);
    expect(verdict).toMatchObject({ ok: true, assumed: [{ decision: { id: "key/countries" }, option: "code" }, { option: "link" }] });
  });
});

describe("the accepted model", () => {
  it("waits while a decision with no default is open", () => {
    expect(accept(DRAFT, NOBEL, (id) => (id === "key/countries" ? "code" : null))).toBeNull();
  });

  it("links across a link file, many per thing", () => {
    const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : "code"))!;
    expect(accepted.edges).toContainEqual({
      name: "affiliation",
      from: "Laureate",
      to: "Institution",
      on: "affiliations",
      column: "institution_id",
      join: { column: "laureate_id" },
      many: true,
      optional: true,
    });
    expect(accepted.types.find((t) => t.name === "Laureate")!.fields.find((f) => f.name === "born")).toMatchObject({ primitive: "date", optional: true });
  });

  it("makes a link file a thing of its own, identified by its two ends, when each row counts", () => {
    const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "thing" : "name"))!;
    expect(accepted.types.find((t) => t.name === "Affiliation")).toMatchObject({ source: "affiliations", identity: ["laureate_id", "institution_id"] });
    expect(accepted.edges.filter((e) => e.from === "Affiliation").map((e) => e.to)).toEqual(["Laureate", "Institution"]);
    expect(accepted.types.find((t) => t.name === "Country")!.identity).toEqual(["name"]);
  });
});

describe("what the person reads", () => {
  it("is a sentence per thing, with one real row looked up across the files", () => {
    const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : "code"))!;
    const relations = relationsOf(accepted, NOBEL);
    expect(relations.find((r) => r.id === "relation/Award")).toEqual({
      id: "relation/Award",
      sentence: "Each award has a laureate, a year, a category and a share",
      example: ["Marie Curie", "1903", "Physics", "4"],
    });
    expect(relations.find((r) => r.id === "relation/Laureate")).toEqual({
      id: "relation/Laureate",
      sentence: "Each laureate has affiliations, a name, a gender and a born",
      example: ["Sorbonne", "Marie Curie", "female", "1867-11-07"],
    });
  });
});
