import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import { accept } from "./model";
import { declare, fossilCheck, type MappingInput, mappingsOf, writeProgram } from "./mapping";
import { DESCRIBING, DRAFT, NOBEL } from "./nobel.fixture";

const BASE = "https://acme.example/";
const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : id === "key/countries" ? "code" : null))!;

/** The mappings of the accepted Nobel. */
const GOOD = `LaureateRows : Laureate from laureates
    @subject = "https://acme.example/id/laureate/{laureates.id}"
    name = laureates.name
    gender = laureates.gender
    born = laureates.born

LaureateAffiliation : Laureate from laureates.join(affiliations, on = laureates.id == affiliations.laureate_id)
    @subject = "https://acme.example/id/laureate/{laureates.id}"
    name = laureates.name
    gender = laureates.gender
    affiliation = Institution(affiliations.institution_id)

AwardRows : Award from awards
    @subject = "https://acme.example/id/award/{awards.id}"
    year = awards.year
    category = awards.category
    share = awards.share
    laureate = Laureate(awards.laureate_id)

InstitutionRows : Institution from institutions
    @subject = "https://acme.example/id/institution/{institutions.id}"
    name = institutions.name
    city = institutions.city

CountryRows : Country from countries
    @subject = "https://acme.example/id/country/{countries.code}"
    name = countries.name`;

let input: MappingInput;

beforeAll(async () => {
  const wasm = createRequire(import.meta.url).resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm");
  await initFossilWasm(readFileSync(wasm));
  const host = { connections: async () => ({}), credentials: async () => [] };
  input = { accepted, ...(await declare(accepted, NOBEL, { base: BASE })), check: fossilCheck({ host, engine: DESCRIBING }) };
});

describe("the mapping's request", () => {
  it("declares the accepted types with keasy's IRIs, and the sources they read", () => {
    const { vocabulary } = input;
    const laureate = vocabulary.declared!.find((t) => t.name === "Laureate")!;
    expect(laureate.iri).toBe("https://acme.example/vocab/Laureate");
    expect(laureate.fields).toContainEqual({ name: "born", iri: "https://acme.example/vocab/born", type: "Option<Date>" });
    expect(laureate.fields).toContainEqual({ name: "affiliation", iri: "https://acme.example/vocab/affiliation", type: "Seq<Ref<Institution>>" });
    expect(vocabulary.declared!.find((t) => t.name === "Award")!.fields).toContainEqual(expect.objectContaining({ name: "laureate", type: "Ref<Laureate>" }));
    expect(vocabulary.sources.map((s) => s.name)).toEqual(["laureates", "awards", "institutions", "affiliations", "countries"]);
  });

  it("computes each subject from the workspace and the type, never the model", () => {
    expect(input.subjects.Laureate).toBe("https://acme.example/id/laureate/{laureates.id}");
    expect(input.prelude).toContain("type Laureate");
  });
});

describe("the mappings", () => {
  it("are one per type, each field from its column, and one more per edge read across a link file", () => {
    expect(mappingsOf(input)).toBe(GOOD);
  });

  it("make a program fossil checks clean: the prelude and them", async () => {
    expect(await writeProgram(input)).toBe(`${input.prelude}\n${GOOD}\n`);
  });

  it("throw what fossil says when the program does not compile", async () => {
    const broken = { ...input, accepted: { ...input.accepted, types: input.accepted.types.map((t) => (t.name === "Institution" ? { ...t, fields: [{ ...t.fields[0]!, column: "nmae" }] } : t)) } };
    await expect(writeProgram(broken)).rejects.toMatchObject({ code: "task/unheld", title: "The program written for these files does not compile." });
  });
});
