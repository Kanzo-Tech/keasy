import { describe, expect, it } from "vitest";
import { runTask, verify } from "@kanzo-tech/ai/task";
import { accept, decisionsOf, modelTask, type Names, relationsOf, structureOf } from "./model";
import { profiledOf } from "./profile";
import { DRAFT, INPUTS, NAMES, NOBEL, PROFILE, scripted } from "./nobel.fixture";

/** The parts of a JSON Schema a test reads. */
interface Schema {
  properties: Record<string, Schema>;
  required: string[];
  additionalProperties: boolean;
}

const input = { profiled: NOBEL, about: "Nobel prizes and the people who won them" };
const task = modelTask(NOBEL);

/** The names with `change` made to a copy of them. */
const changed = (change: (n: Names) => void): Names => {
  const copy = structuredClone(NAMES);
  change(copy);
  return copy;
};

const codes = async (names: Names) => {
  const verdict = await verify(task, names, input);
  return "diagnostics" in verdict ? verdict.diagnostics.map((d) => d.code) : [];
};

describe("the structure, from the profile", () => {
  it("is a thing per file with a key, an edge per inclusion on a key, and a keyless link file as a bridge", () => {
    expect(structureOf(NOBEL)).toEqual({
      types: [
        { source: "laureates", key: "id", columns: ["name", "gender", "born"] },
        { source: "awards", key: "id", columns: ["year", "category", "share"] },
        { source: "institutions", key: "id", columns: ["name", "city"] },
        { source: "countries", key: "code", columns: ["name"] },
      ],
      edges: [
        { via: "awards.laureate_id → laureates.id", from: "awards", to: "laureates" },
        { via: "affiliations.institution_id → institutions.id", from: "laureates", to: "institutions", across: "affiliations" },
      ],
    });
  });

  it("keys a thing by the candidate an inclusion lands on, not by its first", () => {
    // Laureates are pointed at by name: name identifies one, and id is a field.
    const byName = profiledOf(
      {
        ...PROFILE,
        sources: PROFILE.sources.map((s) =>
          s.binding === "awards" ? { ...s, descriptor: { ...s.descriptor, columns: s.descriptor.columns.map((c) => (c.name === "laureate_id" ? { ...c, primitive: "string" as const } : c)) } } : s,
        ),
        inclusions: [{ from: { source: "awards", column: "laureate_id" }, to: { source: "laureates", column: "name" } }],
      },
      INPUTS,
    );
    expect(structureOf(byName).types[0]).toEqual({ source: "laureates", key: "name", columns: ["id", "gender", "born"] });
  });

  it("is what the names are laid on, the draft the decisions and the person read", () => {
    expect(DRAFT.edges).toEqual([
      { name: "laureate", from: "Award", to: "Laureate", via: "awards.laureate_id → laureates.id" },
      { name: "affiliation", from: "Laureate", to: "Institution", via: "affiliations.institution_id → institutions.id" },
    ]);
    expect(DRAFT.types.map((t) => [t.name, t.key])).toEqual([["Laureate", "id"], ["Award", "id"], ["Institution", "id"], ["Country", "code"]]);
  });
});

describe("the model Task's context and contract", () => {
  it("shows the model every thing with its fields and real rows, and every link with its ends", async () => {
    const { model, prompts } = scripted(NAMES);
    await runTask(task, input, { model });
    expect(prompts[0]).toContain("Nobel prizes and the people who won them");
    expect(prompts[0]).toContain("types.laureates (3 rows): one per id; fields: name (string), gender (string), born (date)");
    expect(prompts[0]).toContain("e.g. 1 · Marie Curie · female · 1867-11-07");
    expect(prompts[0]).toContain('edges["affiliations.institution_id → institutions.id"]: from laureates to institutions, across affiliations');
  });

  it("asks for a name per slot of the structure, every one required and no other", () => {
    const { jsonSchema } = task.output!(input, NOBEL) as unknown as { jsonSchema: Schema };
    expect(jsonSchema.properties.types.required).toEqual(["laureates", "awards", "institutions", "countries"]);
    expect(jsonSchema.properties.edges.required).toHaveLength(2);
    expect(jsonSchema.properties.fields.required).toContain("laureates.born");
    expect(jsonSchema.properties.fields.additionalProperties).toBe(false);
  });
});

describe("the model Task's oracles", () => {
  it("accept names that hold, assuming a key where the profile has two", async () => {
    const proposal = await runTask(task, input, { model: scripted(NAMES).model });
    // The affiliations file links laureates to institutions: how that counts is the person's.
    expect(proposal.verdict).toMatchObject({ ok: false, decision: { id: "count/affiliations" } });
    expect(proposal.attempts).toBe(1);
  });

  it("refuse two things of one name, and two members of one thing", async () => {
    expect(await codes(changed((n) => (n.types.countries = "Award")))).toEqual(["model/duplicate-name"]);
    expect(await codes(changed((n) => (n.fields["laureates.gender"] = "name")))).toEqual(["model/duplicate-name"]);
  });

  it("refuse a name that is a word of Fossil", async () => {
    expect(await codes(changed((n) => (n.fields["institutions.city"] = "from")))).toEqual(["model/duplicate-name"]);
  });

  it("send what they refused back, at its slot, and take the repair", async () => {
    const { model, prompts } = scripted(changed((n) => (n.types.countries = "Award")), NAMES);
    const proposal = await runTask(task, input, { model });
    expect(proposal.attempts).toBe(2);
    expect(prompts[1]).toContain("/types/countries: countries and awards are both called Award.");
  });

  it("give up after three attempts, with the diagnostics as the answer", async () => {
    const { model, prompts } = scripted(changed((n) => (n.types.countries = "Award")));
    const proposal = await runTask(task, input, { model });
    expect(prompts).toHaveLength(3);
    expect(proposal.verdict).toMatchObject({ ok: false, diagnostics: [{ code: "model/duplicate-name" }] });
  });
});

describe("the decisions a draft raises", () => {
  it("are the key of a thing nothing points at, assumed, and a link file's count, which blocks", () => {
    const decisions = decisionsOf(DRAFT, NOBEL);
    expect(decisions.map((d) => d.id)).toEqual(["key/countries", "count/affiliations"]);
    expect(decisions[0]!.options.map((o) => o.id)).toEqual(["code", "name"]);
    expect(decisions[1]).toMatchObject({
      question: "Each row of affiliations links laureate to institution. Is a row only that link, or a thing counted on its own?",
      options: [
        { id: "link", label: "Only a link: laureate → institution" },
        { id: "thing", label: "A thing of its own: affiliations" },
      ],
    });
    expect(modelTask(NOBEL).decide).toEqual({ "key/laureates": { assume: "id" }, "key/countries": { assume: "code" } });
  });

  it("raise no key decision for a thing an edge lands on: the edge fixes its key", () => {
    expect(decisionsOf(DRAFT, NOBEL).some((d) => d.id === "key/laureates")).toBe(false);
  });

  it("are settled, without a model, once the person picks", async () => {
    const verdict = await verify({ ...task, decide: { ...task.decide, "count/affiliations": { assume: "link" } } }, NAMES, input);
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
      sentence: "award: laureate, year, category and share",
      example: ["Marie Curie", "1903", "Physics", "4"],
    });
    expect(relations.find((r) => r.id === "relation/Laureate")).toEqual({
      id: "relation/Laureate",
      sentence: "laureate: affiliation, name, gender and born",
      example: ["Sorbonne", "Marie Curie", "female", "1867-11-07"],
    });
  });
});
