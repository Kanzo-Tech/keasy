import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import type { Inferred } from "@fossil-lang/types";
import { infer, initFossilWasm } from "@fossil-lang/wasm";
import { assumedOf, decisionsOf, relationsOf } from "./model";
import { NOBEL, PROFILE } from "./nobel.fixture";

let inferred: Inferred;

// The model is fossil's: its module, booted from its bytes.
beforeAll(async () => {
  await initFossilWasm(readFileSync(createRequire(import.meta.url).resolve("@fossil-lang/wasm/pkg/fossil_wasm_bg.wasm")));
  inferred = await infer(PROFILE);
});

describe("the decisions, from fossil's ambiguities", () => {
  it("are the key of a thing nothing points at, assumed, and a link file's count, which is asked", () => {
    const decisions = decisionsOf(inferred, NOBEL);
    expect(decisions.map((d) => d.id)).toEqual(["key/countries", "count/affiliations"]);
    expect(decisions[0]).toMatchObject({ question: "Which column tells the countries apart?", options: [{ id: "code", detail: "e.g. FR" }, { id: "name", detail: "e.g. France" }] });
    expect(decisions[1]).toMatchObject({
      question: "Each row of affiliations links laureates to institutions. Is a row only that link, or a thing counted on its own?",
      options: [
        { id: "link", label: "Only a link: laureates → institutions" },
        { id: "thing", label: "A thing of its own: affiliations" },
      ],
    });
    expect(inferred.ambiguities.map(assumedOf)).toEqual(["code", null]);
  });

  it("raise no key decision for a thing an edge lands on: the edge fixes its key", () => {
    expect(decisionsOf(inferred, NOBEL).some((d) => d.id === "key/laureates")).toBe(false);
  });
});

describe("what the person reads", () => {
  it("is a sentence per thing, with one real row looked up across the files", async () => {
    const { model } = await infer(PROFILE, { choices: { "count/affiliations": "link" } });
    const relations = relationsOf(model, NOBEL);
    expect(relations.find((r) => r.id === "relation/Awards")).toEqual({
      id: "relation/Awards",
      sentence: "awards: laureate, year, category and share",
      example: ["Marie Curie", "1903", "Physics", "4"],
    });
    expect(relations.find((r) => r.id === "relation/Laureates")).toEqual({
      id: "relation/Laureates",
      sentence: "laureates: institution, name, gender and born",
      example: ["Sorbonne", "Marie Curie", "female", "1867-11-07"],
    });
  });
});
