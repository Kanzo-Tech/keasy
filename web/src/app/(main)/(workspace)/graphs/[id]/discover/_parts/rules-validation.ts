"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { and, column, count, createTable, type ExprNode, isIn, literal, Query, sql, TableRefNode } from "@uwdata/mosaic-sql";
import { engine, numbers, useClauses, useCrossfilter, useMosaic } from "@kanzo-tech/ui/analytics";
import { usePick } from "@kanzo-tech/graph";
import type { RdfFindingGroup, RdfFindingGroups, RdfPlace, Shapes, ShapeModelJson, TermValue } from "@kanzo-tech/rudof-wasm";
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

/**
 * The rules file parsed — none while there is no file; a file rudof cannot read is the failure, a
 * `ShapesError` placed by line and column.
 */
export function useReadRules(text: string | undefined) {
  const { graphId } = useCorpus();
  const read = useQuery({
    queryKey: [...corpusKey(graphId), "rules", text],
    queryFn: async (): Promise<ReadRules> => {
      const { Shapes } = await rudof();
      const shapes = Shapes.parse(text!);
      return { shapes, model: shapes.model() };
    },
    enabled: text !== undefined,
    staleTime: Infinity,
    retry: false,
  });
  return { rules: read.data, failure: read.error ?? undefined };
}

/** The place the rules' badge picks from: its findings and what conforms are one clause on the page. */
const PICK = "rules";

/** A group as the badge keeps it: rudof's, without its places — only how many vertices they are. */
export interface KeptGroup extends Omit<RdfFindingGroup, "places"> {
  places: RdfPlace[];
  /** How many vertices the group's results are at: the N of its *Show N*. */
  vertices: number;
}

/** A group's identity across two checks of one subset: its rule, its path and its severity. */
export const groupKey = (group: Pick<RdfFindingGroup, "rule" | "severity" | "sample">) =>
  `${group.rule.id}|${group.sample[0]?.place.path ?? ""}|${group.severity}`;

/**
 * One check: rudof's groups without their places, what they were checked over — the subset's
 * vertices of all of them — and what was checked, so the badge can say a later filter or a replaced
 * file left it behind. The places are dropped: 17K focus nodes are not held for a Show that may
 * never be pressed, which finds them again over `subset`.
 */
export interface Checked {
  findings: { conforms: boolean; groups: KeptGroup[]; unchecked: RdfFindingGroups["unchecked"] };
  inScope: number;
  total: number;
  /** The subset's subjects, as SQL — `undefined` for the whole corpus. */
  subset: string | undefined;
  /** The rules file checked, as it was. */
  shapes: string;
  /** Per rule, how many vertices each severity flags, each once: the N of *Show all N violations*. */
  flagged: Record<string, Partial<Record<FindingSeverity, number>>>;
}

/** Why the last check no longer says what the page holds: a filter changed, or the file did. */
export type Stale = "filter" | "rules";

/**
 * The rules, validated **on demand** — TopBraid EDG's and GraphDB's *Validate*: nothing checks by
 * itself, so a timeline that plays or a brush that drags runs no validation beside the page's own
 * queries. `check()` validates what the page holds at that moment — every clause but the rules' own,
 * so showing a finding narrows the graph and never the findings — and a second press, or `stop()`,
 * abandons the first: latest wins. The focus nodes are the subjects of the vertices the subset keeps,
 * each checked against the whole corpus.
 */
export function useRules(rules: ReadRules | undefined, text: string) {
  const { graphId } = useCorpus();
  const { coordinator } = useMosaic();
  const pick = usePick(PICK);
  // Re-rendered on every clause, only so the badge can say the subset moved since the last check.
  useClauses(useCrossfilter());
  const vertices = useVertices();
  const key = useGraphKey();
  const predicate = pick.predicate();
  const triples = String(new TableRefNode([graphId, "triples"]));
  const subset = predicate.length
    ? String(Query.from(vertices).select({ s_type: literal("I"), s_value: column("subject") }).where(predicate))
    : undefined;

  const [state, setState] = useState<{ checked?: Checked; checking: boolean; failure?: unknown }>({ checking: false });
  const running = useRef<AbortController | undefined>(undefined);
  // A check left running when the badge goes is abandoned with it.
  useEffect(() => () => running.current?.abort(), []);

  /**
   * The page's engine, and the relation rudof reads the focus nodes from: rudof takes a relation's
   * name, so `over`'s subjects are a view beside the triples, replaced on every read. No subset is
   * no focus, and every target is checked.
   */
  const prepared = async (over: string | undefined, name: string, signal: AbortSignal) => {
    const attachedTo = await engine({ signal });
    if (over === undefined) return { attachedTo, focus: undefined };
    const focus = new TableRefNode([graphId, name]);
    await attachedTo.query(String(createTable(focus, over, { view: true, replace: true })), { signal });
    return { attachedTo, focus: String(focus) };
  };

  /**
   * rudof's groups over `over`, worded in the reader's languages, preferred first — of every rule,
   * or of `shape` alone: that node shape over every target it declares (rudof-wasm 0.4.6's `shape`).
   */
  const validated = async (shapes: Shapes, over: string | undefined, name: string, signal: AbortSignal, shape?: string) => {
    const { attachedTo, focus } = await prepared(over, name, signal);
    const languages = typeof navigator === "undefined" ? [] : [...navigator.languages];
    return { attachedTo, findings: await shapes.validateGroups({ table: triples, focus, engine: attachedTo, signal, languages, shape }) };
  };

  const check = async () => {
    if (!rules) return;
    running.current?.abort();
    const run = new AbortController();
    running.current = run;
    const { signal } = run;
    const over = subset;
    setState((s) => ({ checked: s.checked, checking: true }));
    try {
      const { attachedTo, findings } = await validated(rules.shapes, over, "rules_focus", signal);
      const counted = Query.from(vertices).select({ total: count(), inScope: predicate.length ? count().where(and(...predicate)) : count() });
      const answer = await attachedTo.query(String(counted), { signal });
      const placed = findings.groups.map((group) => ({ ...group, vertices: nodesOf([group]).length }));
      const flagged = Object.fromEntries(
        rulesOf(rules.model, { ...findings, groups: placed }).map((rule) => [
          rule.id,
          Object.fromEntries((["violation", "warning", "info"] as const).map((severity) => [severity, nodesOf(rule.groups, severity).length])),
        ]),
      );
      const groups = placed.map((group) => ({ ...group, places: [] }));
      const checked: Checked = {
        findings: { conforms: findings.conforms, groups, unchecked: findings.unchecked },
        inScope: Number(answer.getChild("inScope")?.get(0)),
        total: Number(answer.getChild("total")?.get(0)),
        subset: over,
        shapes: text,
        flagged,
      };
      if (running.current === run) setState({ checked, checking: false });
    } catch (failure) {
      if (signal.aborted) return;
      if (running.current === run) setState((s) => ({ checked: s.checked, checking: false, failure }));
    } finally {
      if (running.current === run) running.current = undefined;
    }
  };

  const stop = () => {
    running.current?.abort();
    running.current = undefined;
    setState((s) => ({ checked: s.checked, checking: false }));
  };

  const checked = state.checked;
  const stale: Stale | undefined = !checked ? undefined : checked.shapes !== text ? "rules" : checked.subset !== subset ? "filter" : undefined;

  /** The vertices whose subjects `subjects` selects, published as the rules' clause, named `label`. */
  const publish = async (subjects: ExprNode, label: string) => {
    const ids = numbers(await coordinator.query(Query.from(vertices).select(key).where(subjects)), key);
    pick.pick(ids, label);
  };

  /**
   * The focus nodes of `rule`'s groups that `keep` admits, found again: that rule alone, re-checked
   * over the last check's subset, so they are the N its rows count. Asked for by a press, and
   * nothing stops it.
   */
  const nodesAgain = async (rule: Rule, keep: (group: RdfFindingGroup) => boolean) => {
    if (!rules || !checked) return [];
    const { signal } = new AbortController();
    const { findings } = await validated(rules.shapes, checked.subset, "rules_show_focus", signal, rule.id);
    return nodesOf(findings.groups.filter(keep));
  };

  const showNodes = (nodes: readonly string[], label: string) =>
    publish(
      isIn(
        column("subject"),
        nodes.map((node) => literal(node)),
      ),
      label,
    );

  return {
    checked,
    checking: state.checking,
    failure: state.failure,
    stale,
    check,
    stop,
    picked: pick.picked,
    withdraw: () => pick.pick(null, ""),
    /** Show one sampled node: its vertex becomes the rules' clause. */
    show: showNodes,
    /** Show a group of `rule`'s vertices, found again: they become the rules' clause. */
    showGroup: async (rule: Rule, group: KeptGroup, label: string) => {
      const wanted = groupKey(group);
      await showNodes(await nodesAgain(rule, (g) => groupKey(g) === wanted), label);
    },
    /** Show every vertex `rule` flags with `severity`, found again, each once. */
    showSeverity: async (rule: Rule, severity: FindingSeverity, label: string) => {
      const wanted = new Set(rule.groups.filter((g) => g.severity === severity).map(groupKey));
      await showNodes(await nodesAgain(rule, (g) => wanted.has(groupKey(g))), label);
    },
    /** Show what conforms: rudof's Shape Fragment of the subset, its subjects the panel's clause. */
    conforming: async (label: string) => {
      const into = String(new TableRefNode([graphId, "rules_fragment"]));
      // Asked for by a press, and nothing stops it once asked: a signal that never aborts.
      const { signal } = new AbortController();
      const { attachedTo, focus } = await prepared(subset, "rules_focus", signal);
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
  groups: KeptGroup[];
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
export function rulesOf(model: ShapeModelJson, checked: Checked["findings"]): Rule[] {
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
export function nodesOf(groups: readonly Pick<RdfFindingGroup, "places" | "severity">[], severity?: FindingSeverity): string[] {
  const kept = severity ? groups.filter((group) => group.severity === severity) : groups;
  return [...new Set(kept.flatMap((group) => group.places.map((place) => place.focus.value)))];
}
