"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { and, column, count, createTable, type ExprNode, isIn, literal, Query, sql, TableRefNode } from "@uwdata/mosaic-sql";
import { engine, numbers, useClauses, useCrossfilter, useMosaic } from "@kanzo-tech/ui/analytics";
import { usePick } from "@kanzo-tech/graph";
import type { RdfFindingGroup, RdfFindingGroups, Shapes, ShapeModelJson, TermValue } from "@kanzo-tech/rudof-wasm";
import { type FindingSeverity, type FindingTally, tallyFindings } from "@kanzo-tech/ui";
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

/** The place the rules' badge picks from: its findings and what conforms are one clause on the page. */
const PICK = "rules";

/** What the rules were checked over: the subset's vertices, of all of them. */
export interface Checked {
  /** rudof's findings, grouped in Rust: a corpus with many results crosses to JavaScript as its groups. */
  findings: RdfFindingGroups;
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
      // Worded in the reader's languages, preferred first; untagged when none of them is there.
      const languages = typeof navigator === "undefined" ? [] : [...navigator.languages];
      const findings = await rules!.shapes.validateGroups({ table: triples, focus, engine: attachedTo, signal, languages });
      const counted = Query.from(vertices).select({ total: count(), inScope: predicate.length ? count().where(and(...predicate)) : count() });
      const answer = await attachedTo.query(String(counted), { signal });
      return { findings, inScope: Number(answer.getChild("inScope")?.get(0)), total: Number(answer.getChild("total")?.get(0)) };
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

/**
 * A rule — a node shape — and the groups of findings filed under it: rudof's groups, each a
 * constraint of the shape at one path and one severity, the worst and largest first.
 */
export interface Rule {
  id: string;
  name: string;
  off: boolean;
  /** Why rudof did not check it, in rudof's words. */
  unchecked?: string;
  groups: RdfFindingGroup[];
  tally: FindingTally;
}

/** The last segment of an IRI: what a reader calls the type or the property. */
const local = (iri: string) => iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1) || iri;

/** A shape's node as `model()` names it: its IRI, or `_:` and the label of a blank node. */
const shapeId = (node: TermValue) => (node.termType === "BlankNode" ? `_:${node.value}` : node.value);

/**
 * The groups filed under the rules they came from. A group's `sourceShape` is the node of a node
 * shape or of one of its property shapes, so each finds its rule by that node's id. rudof's order —
 * worst, then largest — holds within a rule.
 */
export function rulesOf(model: ShapeModelJson, checked: RdfFindingGroups): Rule[] {
  const owner = new Map<string, Rule>();
  const rules = model.nodeShapes.map((shape) => {
    const rule: Rule = {
      id: shape.id,
      name: shape.targetClasses.map(local).join(", ") || local(shape.id),
      off: Boolean(shape.deactivated),
      groups: [],
      tally: tallyFindings([]),
    };
    owner.set(shape.id, rule);
    for (const property of shape.properties) owner.set(property.id, rule);
    return rule;
  });
  for (const { shape, reason } of checked.unchecked) {
    const rule = owner.get(shapeId(shape));
    if (rule) rule.unchecked = reason;
  }
  for (const group of checked.groups) {
    const rule = group.sourceShape && owner.get(shapeId(group.sourceShape));
    if (rule) rule.groups.push(group);
  }
  for (const rule of rules) rule.tally = tallyFindings(rule.groups);
  return rules;
}

/** Every rule's tally, summed: what the badge reads. */
export const tallyOf = (rules: readonly Rule[]): FindingTally => tallyFindings(rules.flatMap((rule) => rule.groups));

/**
 * The focus nodes of groups, each once: a node that fails two constraints is one vertex on the page.
 * `severity` keeps the groups of one severity, as a rule's *Show all N violations* does.
 */
export function nodesOf(groups: readonly RdfFindingGroup[], severity?: FindingSeverity): string[] {
  const kept = severity ? groups.filter((group) => group.severity === severity) : groups;
  return [...new Set(kept.flatMap((group) => group.places.map((place) => place.focus.value)))];
}
