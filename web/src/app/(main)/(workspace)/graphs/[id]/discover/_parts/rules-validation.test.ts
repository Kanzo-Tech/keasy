import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync, Shapes, type ValidationReport } from "@kanzo-tech/rudof-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { rulesOf } from "./rules-validation";

beforeAll(() => {
  const wasm = createRequire(import.meta.url).resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm");
  initSync({ module: readFileSync(wasm) });
});

const RULES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/> .
ex:PersonRule a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property ex:email .
ex:email sh:path ex:email ; sh:minCount 1 .
ex:ForumRule a sh:NodeShape ; sh:targetClass ex:Forum ; sh:property [ sh:path ex:title ; sh:minCount 1 ] .
ex:PostRule a sh:NodeShape ; sh:targetClass ex:Post .
ex:CommentRule a sh:NodeShape ; sh:targetClass ex:Comment ; sh:deactivated true .
`;

const iri = (value: string) => ({ termType: "NamedNode", value });

const violation = (focus: string) => ({
  focusNode: iri(focus),
  pathKey: "<https://example.org/email>",
  resultMessage: [{ value: "Less than 1 values", language: "" }],
  resultSeverity: "http://www.w3.org/ns/shacl#Violation",
  sourceConstraintComponent: "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
  sourceShape: iri("https://example.org/email"),
});

describe("a report, filed under the rules of the file", () => {
  it("files a property shape's results under the node shape that holds it, one finding per constraint", () => {
    const model = Shapes.parse(RULES).model();
    const report: ValidationReport = {
      conforms: false,
      results: [violation("https://example.org/p1"), violation("https://example.org/p2")],
      unchecked: [{ shape: iri("https://example.org/PostRule"), reason: "outside the profile" }],
    };
    const rules = Object.fromEntries(rulesOf(model, report).map((rule) => [rule.name, rule]));

    expect(rules.Person.findings).toEqual([
      {
        id: expect.any(String),
        variant: "destructive",
        message: "Less than 1 values",
        where: "Person · email · MinCount",
        nodes: ["https://example.org/p1", "https://example.org/p2"],
      },
    ]);
    expect(rules.Forum.findings).toEqual([]);
    expect(rules.Post.unchecked).toBe("outside the profile");
    expect(rules.Comment.off).toBe(true);
  });
});
