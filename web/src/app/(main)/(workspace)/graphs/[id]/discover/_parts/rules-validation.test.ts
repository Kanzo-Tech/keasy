import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initSync, Shapes } from "@kanzo-tech/rudof-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Checked, groupKey, type KeptGroup, nodesOf, rulesOf, tallyOf } from "./rules-validation";

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

/** A group as rudof's `validateGroups` answers it: `count` results at `places`, filed by `sourceShape`. */
const group = (shape: { termType: string; value: string }, severity: KeptGroup["severity"], focus: string[], count = focus.length): KeptGroup => {
  const rule = { id: `${shape.value}|MinCount`, label: "email · MinCount" };
  const places = focus.map((node) => ({ focus: iri(node), path: "<https://example.org/email>" }));
  return {
    rule,
    severity,
    message: "Less than 1 values",
    count,
    places,
    sample: places.slice(0, 3).map((place) => ({ severity, message: "Less than 1 values", rule, place })),
    sourceShape: shape,
    sourceConstraintComponent: "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
    vertices: places.length,
  };
};

describe("rudof's groups, filed under the rules of the file", () => {
  it("files a property shape's groups under the node shape that holds it, and tallies each rule by its results", () => {
    const model = Shapes.parse(RULES).model();
    const checked: Checked["findings"] = {
      conforms: false,
      // Two people, one of them failing twice: three results at two places.
      groups: [group(iri("https://example.org/email"), "violation", ["https://example.org/p1", "https://example.org/p2"], 3)],
      unchecked: [{ shape: iri("https://example.org/PostRule"), reason: "outside the profile" }],
    };
    const rules = Object.fromEntries(rulesOf(model, checked).map((rule) => [rule.name, rule]));

    expect(rules.Person.groups.map((g) => g.rule.label)).toEqual(["email · MinCount"]);
    expect(rules.Person.tally).toEqual({ violation: 3, warning: 0, info: 0, total: 3 });
    expect(rules.Forum.groups).toEqual([]);
    expect(rules.Forum.tally.total).toBe(0);
    expect(rules.Post.unchecked).toBe("outside the profile");
    expect(rules.Comment.off).toBe(true);
    expect(tallyOf(Object.values(rules))).toEqual({ violation: 3, warning: 0, info: 0, total: 3 });
  });

  it("files the groups of an anonymous property shape, whose sourceShape is a blank node", () => {
    const model = Shapes.parse(RULES).model();
    // `model()` names a blank node `_:` and its label; the group's term carries the label alone.
    const title = model.nodeShapes.find((shape) => shape.id === "https://example.org/ForumRule")?.properties[0]?.id ?? "";
    const checked: Checked["findings"] = {
      conforms: false,
      groups: [group({ termType: "BlankNode", value: title.replace(/^_:/, "") }, "violation", ["https://example.org/f1"])],
      unchecked: [],
    };
    const rules = Object.fromEntries(rulesOf(model, checked).map((rule) => [rule.name, rule]));

    expect(rules.Forum.groups.flatMap((g) => g.places.map((p) => p.focus.value))).toEqual(["https://example.org/f1"]);
    expect(rules.Person.groups).toEqual([]);
  });

  it("drops a group whose shape is in no rule of the file", () => {
    const model = Shapes.parse(RULES).model();
    const checked: Checked["findings"] = { conforms: false, groups: [group(iri("https://example.org/elsewhere"), "warning", ["x"])], unchecked: [] };
    expect(tallyOf(rulesOf(model, checked)).total).toBe(0);
  });
});

describe("a group, known again by a later check of one subset", () => {
  it("is its rule, its path and its severity, whatever its places", () => {
    const shape = iri("https://example.org/email");
    const kept: KeptGroup = { ...group(shape, "violation", ["a1"]), places: [] };
    expect(groupKey(kept)).toBe(groupKey(group(shape, "violation", ["a1", "a2"])));
    expect(groupKey(group(shape, "violation", ["a1"]))).not.toBe(groupKey(group(shape, "warning", ["a1"])));
  });
});

describe("the vertices a rule's groups show", () => {
  const shape = iri("https://example.org/email");
  const groups = [
    group(shape, "violation", ["a1", "a2"]),
    group(shape, "violation", ["a3"]),
    group(shape, "warning", ["a2", "a4"]),
    group(shape, "warning", ["a4", "a5"]),
  ];

  it("are the union of their focus nodes, each node once, of one severity or of all", () => {
    expect(nodesOf(groups, "violation")).toEqual(["a1", "a2", "a3"]);
    expect(nodesOf(groups, "warning")).toEqual(["a2", "a4", "a5"]);
    expect(nodesOf(groups)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("are nothing for a severity the rule has no group of", () => {
    expect(nodesOf(groups, "info")).toEqual([]);
  });
});
