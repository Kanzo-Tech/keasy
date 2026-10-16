import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { initFossilWasm } from "@fossil-lang/wasm";
import { runTask } from "@kanzo-tech/ai/task";
import { accept } from "./model";
import { declare, fossilCheck, mapping, type MappingInput, programOf } from "./mapping";
import { DESCRIBING, DRAFT, NOBEL, scripted } from "./nobel.fixture";

const BASE = "https://acme.example/";
const accepted = accept(DRAFT, NOBEL, (id) => (id === "count/affiliations" ? "link" : id === "key/countries" ? "code" : null))!;

/** The mappings a good model writes over the accepted Nobel. */
const GOOD = `Laureates : Laureate from laureates
    @subject = "https://acme.example/id/laureate/{laureates.id}"
    name = laureates.name
    gender = laureates.gender
    born = laureates.born

Awards : Award from awards
    @subject = "https://acme.example/id/award/{awards.id}"
    year = awards.year
    category = awards.category
    share = awards.share
    laureate = Laureate(awards.laureate_id)

Institutions : Institution from institutions
    @subject = "https://acme.example/id/institution/{institutions.id}"
    name = institutions.name
    city = institutions.city

Countries : Country from countries
    @subject = "https://acme.example/id/country/{countries.code}"
    name = countries.name

Affiliations : Laureate from laureates.join(affiliations, on = laureates.id == affiliations.laureate_id)
    @subject = "https://acme.example/id/laureate/{laureates.id}"
    name = laureates.name
    gender = laureates.gender
    affiliation = Institution(affiliations.institution_id)
`;

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
    expect(input.prelude).toContain('type Laureate');
    expect(input.grammar).toContain('"laureates.name"');
  });
});

describe("the mapping Task", () => {
  it("takes mappings fossil checks clean, and the program is the prelude and them", async () => {
    const { model, prompts } = scripted(GOOD);
    const proposal = await runTask(mapping, input, { model });
    expect(proposal.verdict).toEqual({ ok: true });
    expect(proposal.attempts).toBe(1);
    expect(programOf(input, proposal.value)).toBe(`${input.prelude}\n${GOOD}`);
    expect(prompts[0]).toContain('@subject = "https://acme.example/id/award/{awards.id}"');
  });

  it("sends fossil's own diagnostic back, at its line, and takes the repair", async () => {
    const typo = GOOD.replace("city = institutions.city", "city = institutions.name\n    name = institutions.nmae");
    const { model, prompts } = scripted(typo, GOOD);
    const proposal = await runTask(mapping, input, { model });
    expect(proposal.verdict).toEqual({ ok: true });
    expect(proposal.attempts).toBe(2);
    expect(prompts[1]).toMatch(/It does not hold:[\s\S]*line 18: `nmae` is not a field of `institutions`/);
  });

  it("refuses a type with no mapping, and a subject that is not keasy's", async () => {
    const without = GOOD.split("\n\n").filter((m) => !m.startsWith("Countries")).join("\n\n").replace("/id/award/", "/awards/");
    const proposal = await runTask(mapping, input, { model: scripted(without).model });
    expect(proposal.verdict.ok).toBe(false);
    const codes = "diagnostics" in proposal.verdict ? proposal.verdict.diagnostics.map((d) => d.code) : [];
    expect(codes).toEqual(expect.arrayContaining(["mapping/unmapped", "mapping/subject"]));
  });

  it("refuses an edge no mapping writes", async () => {
    const without = GOOD.split("\n\n").filter((m) => !m.startsWith("Affiliations")).join("\n\n");
    const proposal = await runTask(mapping, input, { model: scripted(without).model });
    expect("diagnostics" in proposal.verdict && proposal.verdict.diagnostics.map((d) => d.code)).toContain("mapping/missing-edge");
  });

  it("asks three times, no more, and then the diagnostics are the answer", async () => {
    const { model, prompts } = scripted(GOOD.replace("born = laureates.born", "born = laureates.name"));
    const proposal = await runTask(mapping, input, { model });
    expect(prompts).toHaveLength(3);
    expect(proposal.attempts).toBe(3);
    expect(proposal.verdict.ok).toBe(false);
  });
});
