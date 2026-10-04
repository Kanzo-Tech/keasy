import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync, Session } from "@kanzo-tech/rudof-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { compilePlan } from "./rules-validation";

beforeAll(() => {
  const wasm = createRequire(import.meta.url).resolve("@kanzo-tech/rudof-wasm").replace(/rudof_wasm\.js$/, "rudof_wasm_bg.wasm");
  initSync({ module: readFileSync(wasm) });
});

/** A graph's catalog: its UUID, which is a SQL object name only when delimited. */
const CATALOG = "de3c09eb-2425-4bd6-be88-6b56b1210012";

const MAPPING = `
@prefix rml: <http://w3id.org/rml/> .
<#corpus> a rml:Source .
<#Person> a rml:TriplesMap ;
  rml:logicalSource [ rml:source <#corpus> ; rml:iterator "\\"Person\\"" ; rml:referenceFormulation rml:SQL2008Table ] ;
  rml:subjectMap [ rml:reference "subject" ; rml:termType rml:IRI ; rml:class <https://example.org/Person> ] ;
  rml:predicateObjectMap [ rml:predicate <https://example.org/birthYear> ; rml:objectMap [ rml:reference "birthYear" ] ] .
`;

const RULE = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
<https://example.org/rule> a sh:NodeShape ;
  sh:targetClass <https://example.org/Person> ;
  sh:property [ sh:path <https://example.org/birthYear> ; sh:minCount 1 ] .
`;

describe("a graph's rules, compiled for its corpus", () => {
  it("compile under the graph's UUID catalog, which reads every table from it", () => {
    const session = new Session();
    session.loadShapes(RULE, "text/turtle");
    const plan = compilePlan(session, MAPPING, CATALOG);
    expect(plan.checks.length).toBeGreaterThan(0);
    for (const check of plan.checks) expect(check.sql).toContain(`"${CATALOG}"`);
  });
});
