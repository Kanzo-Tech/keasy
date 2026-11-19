import { describe, expect, it } from "vitest";
import { accept, decisionsOf, defaultsOf, fieldName, namesOf, relationsOf, structureOf } from "./model";
import { profiledOf } from "./profile";
import { DRAFT, INPUTS, NOBEL, PROFILE } from "./nobel.fixture";

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

describe("the names, from the files' own words", () => {
  it("names a thing by its file, singular, and an edge by the column it leaves from", () => {
    expect(namesOf(structureOf(NOBEL))).toEqual({
      types: { laureates: "Laureate", awards: "Award", institutions: "Institution", countries: "Country" },
      edges: { "awards.laureate_id → laureates.id": "laureate", "affiliations.institution_id → institutions.id": "institution" },
    });
  });

  it("names a field by its column, never a word of Fossil's", () => {
    expect(["birth_date", "name", "laureate_id", "from", "2nd"].map(fieldName)).toEqual(["birthDate", "name", "laureateId", "fromValue", "f2nd"]);
  });

  it("numbers a name already taken in its scope", () => {
    const structure = { types: [{ source: "award", key: "id", columns: ["year"] }, { source: "awards", key: "id", columns: [] }], edges: [{ via: "award.year_id → awards.id", from: "award", to: "awards" }] };
    expect(namesOf(structure)).toEqual({ types: { award: "Award", awards: "Award2" }, edges: { "award.year_id → awards.id": "year2" } });
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
    expect(defaultsOf(NOBEL)).toEqual({ "key/laureates": { assume: "id" }, "key/countries": { assume: "code" } });
  });

  it("raise no key decision for a thing an edge lands on: the edge fixes its key", () => {
    expect(decisionsOf(DRAFT, NOBEL).some((d) => d.id === "key/laureates")).toBe(false);
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
