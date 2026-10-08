"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { and, column, count, createTable, type ExprNode, isIn, literal, Query, sql, TableRefNode } from "@uwdata/mosaic-sql";
import { engine, numbers, useClauses, useCrossfilter, useMosaic } from "@kanzo-tech/ui/analytics";
import { usePick } from "@kanzo-tech/graph";
import type { LangString, Shapes, ShapeModelJson, TermValue, ValidationReport } from "@kanzo-tech/rudof-wasm";
import { corpusKey, useCorpus, useGraphKey, useVertices } from "@/lib/fossil/corpus";

/**
 * A graph's rules, run by rudof on the page's one DuckDB over the corpus as RDF — the
 * `"<graph>".triples` view fossil's `attach` creates. rudof parses the file, validates the triples
 * whose subjects are in the page's subset, and writes the Shape Fragment of what conforms; keasy
 * only says which subset and reads the answer back.
 */

/** rudof's SHACL stack, instantiated once and only when the rules are read: the graph never loads it. */
let rudofOnce: Promise<typeof import("@kanzo-tech/rudof-wasm")> | undefined;
function rudof() {
  if (!rudofOnce) {
    const loading = import("@kanzo-tech/rudof-wasm").then(async (module) => {
      await module.default();
      return module;
    });
    rudofOnce = loading;
    // A failed instantiation is not kept: the next read tries again.
    loading.catch(() => rudofOnce === loading && (rudofOnce = undefined));
  }
  return rudofOnce;
}

/** The rules file as rudof read it: the shapes it runs, and the model a reader names them by. */
export interface ReadRules {
  shapes: Shapes;
  model: ShapeModelJson;
}

/** The rules file parsed; a file rudof cannot read is the failure, a `ShapesError` placed by line and column. */
export function useReadRules(text: string) {
  const { graphId } = useCorpus();
  const read = useQuery({
    queryKey: [...corpusKey(graphId), "rules", text],
    queryFn: async (): Promise<ReadRules> => {
      const { Shapes } = await rudof();
      const shapes = Shapes.parse(text);
      return { shapes, model: shapes.model() };
    },
    staleTime: Infinity,
    retry: false,
  });
  return { rules: read.data, failure: read.error ?? undefined };
}

/** The place the Rules panel picks from: its findings and what conforms are one clause on the page. */
const PICK = "rules";

/** What the rules were checked over: the subset's vertices, of all of them. */
export interface Checked {
  report: ValidationReport;
  inScope: number;
  total: number;
}

/**
 * The rules, validated over the page's subset — every clause but the panel's own, so showing a
 * finding narrows the graph and never the findings. The focus nodes are the subjects of the
 * vertices the subset keeps, each checked against the whole corpus.
 */
export function useRules(rules: ReadRules | undefined) {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  const pick = usePick(PICK);
  // Re-rendered on every clause, so the predicate below is the subset as it is now.
  useClauses(useCrossfilter());
  const vertices = useVertices();
  const key = useGraphKey();
  const predicate = pick.predicate();
  const triples = String(new TableRefNode([graphId, "triples"]));
  const subset = predicate.length
    ? String(Query.from(vertices).select({ s_type: literal("I"), s_value: column("subject") }).where(predicate))
    : undefined;

  /**
   * The page's engine, and the relation rudof reads the focus nodes from: rudof takes a relation's
   * name, so the subset's subjects are a view beside the triples, replaced on every read. Nothing
   * picked elsewhere is no focus, and every target is checked.
   */
  const prepared = async (signal: AbortSignal) => {
    const attachedTo = await engine({ signal });
    if (subset === undefined) return { attachedTo, focus: undefined };
    const focus = new TableRefNode([graphId, "rules_focus"]);
    await attachedTo.query(String(createTable(focus, subset, { view: true, replace: true })), { signal });
    return { attachedTo, focus: String(focus) };
  };

  const checked = useQuery({
    queryKey: [...corpusKey(graphId), "rules", "report", rules?.shapes, subset ?? ""],
    queryFn: async ({ signal }): Promise<Checked> => {
      const { attachedTo, focus } = await prepared(signal);
      const report = await rules!.shapes.validate({ table: triples, focus, engine: attachedTo, signal });
      const counted = Query.from(vertices).select({ total: count(), inScope: predicate.length ? count().where(and(...predicate)) : count() });
      const answer = await attachedTo.query(String(counted), { signal });
      return { report, inScope: Number(answer.getChild("inScope")?.get(0)), total: Number(answer.getChild("total")?.get(0)) };
    },
    enabled: rules !== undefined,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });

  /** The vertices whose subjects `subjects` selects, published as the panel's clause, named `label`. */
  const publish = async (subjects: ExprNode, label: string) => {
    const ids = numbers(await coordinator.query(Query.from(vertices).select(key).where(subjects)), key);
    pick.pick(ids, label);
  };

  return {
    checked: checked.data,
    failure: checked.error ?? undefined,
    picked: pick.picked,
    withdraw: () => pick.pick(null, ""),
    /** Show the focus nodes of a finding: its vertices become the panel's clause. */
    show: (nodes: readonly string[], label: string) =>
      publish(
        isIn(
          column("subject"),
          nodes.map((node) => literal(node)),
        ),
        label,
      ),
    /** Show what conforms: rudof's Shape Fragment of the subset, its subjects the panel's clause. */
    conforming: async (label: string) => {
      const into = String(new TableRefNode([graphId, "rules_fragment"]));
      // Asked for by a press, and nothing stops it once asked: a signal that never aborts.
      const { signal } = new AbortController();
      const { attachedTo, focus } = await prepared(signal);
      await rules!.shapes.fragment({ table: triples, focus, engine: attachedTo, into, signal });
      await publish(sql`${column("subject")} IN (SELECT s_value FROM ${into})`, label);
    },
  };
}

/** One finding: a constraint of a rule, and the focus nodes that fail it. */
export interface Finding {
  id: string;
  variant: "destructive" | "warning" | "info";
  message: string;
  where: string;
  nodes: string[];
}

/** A rule — a node shape — and what the report says of it. */
export interface Rule {
  id: string;
  name: string;
  checks: string;
  off: boolean;
  /** Why rudof did not check it, in rudof's words. */
  unchecked?: string;
  findings: Finding[];
}

const VARIANT: Record<string, Finding["variant"]> = {
  "http://www.w3.org/ns/shacl#Violation": "destructive",
  "http://www.w3.org/ns/shacl#Warning": "warning",
};

/** The last segment of an IRI: what a reader calls the type or the property. */
const local = (iri: string) => iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1) || iri;

/** The message in the reader's language, else the engine's own, untagged. */
function wordOf(messages: LangString[]): string | undefined {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const language of [...languages, ""]) {
    const found = messages.find((m) => m.language === language);
    if (found) return found.value;
  }
  return messages[0]?.value;
}

/** A shape's node as `model()` names it: its IRI, or `_:` and the label of a blank node. */
const shapeId = (node: TermValue) => (node.termType === "BlankNode" ? `_:${node.value}` : node.value);

/**
 * The report filed under the rules it came from. A result's `sourceShape` is the node of a node
 * shape or of one of its property shapes, so each finds its rule by that node's id.
 */
export function rulesOf(model: ShapeModelJson, report: ValidationReport): Rule[] {
  const owner = new Map<string, Rule>();
  const rules = model.nodeShapes.map((shape) => {
    const rule: Rule = {
      id: shape.id,
      name: shape.targetClasses.map(local).join(", ") || local(shape.id),
      checks: shape.properties.map((p) => local(p.pathKey.replace(/[<>]/g, ""))).join(" · "),
      off: Boolean(shape.deactivated),
      findings: [],
    };
    owner.set(shape.id, rule);
    for (const property of shape.properties) owner.set(property.id, rule);
    return rule;
  });
  for (const { shape, reason } of report.unchecked) {
    const rule = owner.get(shapeId(shape));
    if (rule) rule.unchecked = reason;
  }
  const found = new Map<string, Finding>();
  for (const result of report.results) {
    const shape = result.sourceShape ? shapeId(result.sourceShape) : "";
    const rule = owner.get(shape);
    if (!rule) continue;
    const component = result.sourceConstraintComponent ?? "";
    const id = `${shape}|${component}|${result.pathKey ?? ""}`;
    let finding = found.get(id);
    if (!finding) {
      finding = {
        id,
        variant: VARIANT[result.resultSeverity] ?? "info",
        message: wordOf(result.resultMessage) ?? local(component),
        where: [rule.name, result.pathKey && local(result.pathKey.replace(/[<>]/g, "")), local(component).replace(/ConstraintComponent$/, "")]
          .filter(Boolean)
          .join(" · "),
        nodes: [],
      };
      found.set(id, finding);
      rule.findings.push(finding);
    }
    finding.nodes.push(result.focusNode.value);
  }
  const worst = (f: Finding) => ["destructive", "warning", "info"].indexOf(f.variant);
  for (const rule of rules) rule.findings.sort((a, b) => worst(a) - worst(b) || b.nodes.length - a.nodes.length);
  return rules;
}
