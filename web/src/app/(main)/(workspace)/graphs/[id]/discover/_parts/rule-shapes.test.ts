import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync, Session } from "@kanzo-tech/rudof-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { EMPTY_RULES, RULE_SHAPE, ruleShapes } from "./rule-shapes";

beforeAll(() => {
  const wasm = createRequire(import.meta.url).resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm");
  initSync({ module: readFileSync(wasm) });
});

const PERSON = "https://example.org/Person";
const BIRTH_YEAR = "https://example.org/birthYear";

describe("the shapes a rule is edited through", () => {
  it("are SHACL rudof reads, with the rule shape targeting node shapes", () => {
    const model = new Session().loadShapes(ruleShapes({ classes: [PERSON], properties: [BIRTH_YEAR] }), "text/turtle") as {
      nodeShapes: { id: string; targetClasses: string[] }[];
    };
    const rule = model.nodeShapes.find((s) => s.id === RULE_SHAPE);
    expect(rule?.targetClasses).toEqual(["http://www.w3.org/ns/shacl#NodeShape"]);
  });

  it("offer the graph's own types and properties as the choices", () => {
    const text = ruleShapes({ classes: [PERSON], properties: [BIRTH_YEAR] });
    expect(text).toContain(`sh:in ( <${PERSON}> )`);
    expect(text).toContain(`sh:in ( <${BIRTH_YEAR}> )`);
  });

  it("start a document a rule written in them is read from", () => {
    const rules = `${EMPTY_RULES}<urn:uuid:1> a sh:NodeShape ; sh:targetClass <${PERSON}> ;
      sh:property [ sh:path <${BIRTH_YEAR}> ; sh:minInclusive 1990 ] .`;
    const model = new Session().loadShapes(rules, "text/turtle") as { nodeShapes: { id: string }[] };
    expect(model.nodeShapes.map((s) => s.id)).toEqual(["urn:uuid:1"]);
  });
});
