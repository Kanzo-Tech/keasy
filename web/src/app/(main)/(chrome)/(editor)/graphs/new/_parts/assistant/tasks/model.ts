/**
 * **The `model` Task** — docs/design/assistant.md, *The three Tasks*. The model proposes the things
 * the data is about, named in the person's words: a type per thing, the file it stands on, the
 * column that identifies it, the columns it keeps, and the edges between types — each picked from
 * the profile's closed lists, never invented. The oracles hold each pick to a fact of the profile;
 * what the profile cannot settle is a `Decision`, raised here and never by the model.
 *
 * IRIs are not here: `mapping` computes them from the workspace and the names.
 */

import { jsonSchema } from "ai";
import { defineTask, type Decision, type Finding } from "@kanzo-tech/ai/task";
import type { Relation } from "../model";
import { type Inclusion, type Profiled, rowsOf, type Source, sourceNamed, valuesOf } from "./profile";
import { camel, listed, pascal, plural, singular, spoken, withArticle } from "./words";

// ── The artefact ────────────────────────────────────────────────────────────

/** A thing, as the model proposes it. */
export interface DraftType {
  /** In the person's words, singular: `Laureate`. */
  name: string;
  /** The file it stands on: a source's binding. */
  source: string;
  /** The column that identifies one: a candidate key of `source`. */
  key: string;
  /** The columns it keeps, each under a name of the person's. */
  fields: { name: string; column: string }[];
}

/** A link between two things, backed by an inclusion of the profile. */
export interface DraftEdge {
  /** What one is to the other, in the person's words: `laureate`. */
  name: string;
  from: string;
  to: string;
  /** The inclusion that backs it, by its id. */
  via: string;
}

/** What the model writes. */
export interface Draft {
  types: DraftType[];
  edges: DraftEdge[];
}

export interface ModelInput {
  profiled: Profiled;
  /** *What is it about?*, as the person answered it; `""` when skipped. */
  about: string;
}

// ── What a draft says, read against the profile ─────────────────────────────

/** How an edge reaches its `to`: from its `from`'s own file, or across a file no type stands on. */
export type Backing =
  | { kind: "direct"; inclusion: Inclusion }
  /** `back` lands on the `from` type's key from the same link file `inclusion` leaves. */
  | { kind: "link"; inclusion: Inclusion; back: Inclusion };

/** The inclusion behind `edge`, or `undefined` when none backs it. */
function backing(edge: DraftEdge, draft: Draft, profiled: Profiled): Backing | undefined {
  const inclusion = profiled.inclusions.find((i) => i.id === edge.via);
  const from = draft.types.find((t) => t.name === edge.from);
  const to = draft.types.find((t) => t.name === edge.to);
  if (!inclusion || !from || !to) return undefined;
  if (inclusion.to.source !== to.source || inclusion.to.column !== to.key) return undefined;
  if (inclusion.from.source === from.source) return { kind: "direct", inclusion };
  if (draft.types.some((t) => t.source === inclusion.from.source)) return undefined;
  const back = profiled.inclusions.find(
    (i) => i.from.source === inclusion.from.source && i.to.source === from.source && i.to.column === from.key && i !== inclusion,
  );
  return back ? { kind: "link", inclusion, back } : undefined;
}

/** The id of the decision on a source's key. */
const keyDecision = (source: string) => `key/${source}`;
/** The id of the decision on a link file: a link, or a thing counted on its own. */
const countDecision = (source: string) => `count/${source}`;

/**
 * Every decision a draft raises, in the order the chat asks them: a type whose file has several
 * candidate keys and that no edge points at (an edge fixes the key it lands on) — which column
 * identifies one; and each file a draft links across — a link, or a thing of its own.
 */
export function decisionsOf(draft: Draft, profiled: Profiled): Decision[] {
  const decisions: Decision[] = [];
  for (const type of draft.types) {
    const source = sourceNamed(profiled, type.source);
    if (!source || source.keys.length < 2) continue;
    if (draft.edges.some((e) => e.to === type.name)) continue;
    decisions.push({
      id: keyDecision(source.name),
      question: `Which column tells one ${spoken(type.name)} from another?`,
      options: source.keys.map((k) => ({ id: k, label: spoken(k), detail: exampleOf(source, k) })),
    });
  }
  const linked = new Set<string>();
  for (const edge of draft.edges) {
    const backed = backing(edge, draft, profiled);
    if (backed?.kind !== "link" || linked.has(backed.inclusion.from.source)) continue;
    const link = backed.inclusion.from.source;
    linked.add(link);
    const [from, to] = [spoken(edge.from), spoken(edge.to)];
    decisions.push({
      id: countDecision(link),
      question: `Each row of ${link} links ${withArticle(from)} to ${withArticle(to)}. When two ${plural(from)} share ${withArticle(to)}, is that one thing or two?`,
      options: [
        { id: "link", label: `One: ${withArticle(from)} has ${plural(to)}`, detail: `${link} only links them` },
        { id: "thing", label: `Two: each row is ${withArticle(spoken(singular(link)))}`, detail: `counted on its own` },
      ],
    });
  }
  return decisions;
}

/** A source's first value of `column`: what an option's detail shows. */
function exampleOf(source: Source, column: string): string | undefined {
  const [value] = valuesOf(source, column);
  return value === undefined ? undefined : `e.g. ${value}`;
}

/**
 * The decisions a safe default settles, from the profile alone: a key, which any candidate is — the
 * first, in the profile's order. A link file has none: how a thing is counted is the person's.
 */
export function defaultsOf(profiled: Profiled): Record<string, { assume: string }> {
  return Object.fromEntries(
    profiled.sources.filter((s) => s.keys.length > 1).map((s) => [keyDecision(s.name), { assume: s.keys[0]! }]),
  );
}

// ── The oracles ─────────────────────────────────────────────────────────────

/** Every field's column is a column of its type's own file. */
function columnsExist(draft: Draft, input: ModelInput): Finding[] {
  return draft.types.flatMap((type, t) => {
    const source = sourceNamed(input.profiled, type.source);
    const columns = source?.columns.map((c) => c.name) ?? [];
    return type.fields.flatMap((field, f) =>
      columns.includes(field.column)
        ? []
        : [
            {
              code: "model/foreign-column",
              at: `/types/${t}/fields/${f}/column`,
              message: `${type.name}.${field.name}: ${field.column} is not a column of ${type.source}, whose columns are ${columns.join(", ")}.`,
            },
          ],
    );
  });
}

/** Every type's key is a candidate key of its file: unique and never empty, as the profile read it. */
function keysUnique(draft: Draft, input: ModelInput): Finding[] {
  return draft.types.flatMap((type, t) => {
    const keys = sourceNamed(input.profiled, type.source)?.keys ?? [];
    if (keys.includes(type.key)) return [];
    const which = keys.length > 0 ? `its candidate keys are ${keys.join(", ")}` : `it has no column unique in every row`;
    return [{ code: "model/not-a-key", at: `/types/${t}/key`, message: `${type.name}: ${type.key} does not identify a row of ${type.source}; ${which}.` }];
  });
}

/** Every edge names types the draft has, and an inclusion that lands on its `to`'s key. */
function edgesBacked(draft: Draft, input: ModelInput): Finding[] {
  const names = draft.types.map((t) => t.name);
  return draft.edges.flatMap((edge, e): Finding[] => {
    const unknown = [edge.from, edge.to].filter((n) => !names.includes(n));
    if (unknown.length > 0) {
      return [{ code: "model/unknown-type", at: `/edges/${e}`, message: `${edge.name}: ${unknown.join(", ")} is not a type you proposed (${names.join(", ")}).` }];
    }
    if (backing(edge, draft, input.profiled)) return [];
    const to = draft.types.find((t) => t.name === edge.to)!;
    return [
      {
        code: "model/unbacked-edge",
        at: `/edges/${e}/via`,
        message: `${edge.from} ${edge.name} ${edge.to}: ${edge.via} does not link them — it must land on ${to.source}.${to.key} and leave from ${edge.from}'s file, or from a file no type stands on that also links to ${edge.from}.`,
      },
    ];
  });
}

const RESERVED = ["from", "and", "or", "not", "true", "false", "null"];

/** No two types share a name, nor two fields or edges of one type, and none is a word of Fossil's. */
function namesDistinct(draft: Draft): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const [t, type] of draft.types.entries()) {
    if (seen.has(type.name)) findings.push({ code: "model/duplicate-name", at: `/types/${t}/name`, message: `Two types are called ${type.name}.` });
    seen.add(type.name);
    const own = [...type.fields.map((f) => f.name), ...draft.edges.filter((e) => e.from === type.name).map((e) => e.name)];
    for (const name of new Set(own)) {
      if (own.filter((n) => n === name).length > 1) findings.push({ code: "model/duplicate-name", at: `/types/${t}`, message: `${type.name} has two fields or edges called ${name}.` });
      if (RESERVED.includes(name)) findings.push({ code: "model/duplicate-name", at: `/types/${t}`, message: `${type.name}.${name}: "${name}" is a reserved word; name it otherwise.` });
    }
  }
  return findings;
}

/** The decisions the draft raises, each as the oracles' question for the person. */
const ambiguities = (draft: Draft, input: ModelInput): Finding[] => decisionsOf(draft, input.profiled).map((decision) => ({ decision }));

// ── The Task ────────────────────────────────────────────────────────────────

const MODEL = `You design what a person's data is about, as things and the links between them.
Propose one type per kind of thing in the files: a singular name in the person's words (PascalCase), the file it stands on (source), the column that identifies one (key, one of that file's candidate keys), and the columns worth keeping as fields, each under a short camelCase name.
Link two types with an edge only through an inclusion listed: "via" is its id, "to" the type whose file and key it lands on, "from" the type whose file it leaves. A file that only links two others is not a type: link across it, with "via" its inclusion into "to".
Use only the files, columns and inclusions listed.`;

/** One source as the model reads it: its columns and types, its keys and two real rows. */
function described(source: Source): string {
  const rows = source.sample.slice(0, 2).map((r) => `  e.g. ${r.map((v) => v ?? "—").join(" · ")}`);
  const count = source.rows === null ? "" : ` (${source.rows} rows)`;
  return [
    `- ${source.name}${count}: ${source.columns.map((c) => `${c.name} (${c.primitive})`).join(", ")}`,
    `  candidate keys: ${source.keys.length > 0 ? source.keys.join(", ") : "none"}`,
    ...rows,
  ].join("\n");
}

const NAME = "^[A-Z][A-Za-z0-9]*$";
const MEMBER = "^[a-z][A-Za-z0-9]*$";

/** The artefact's schema: every file, column and inclusion an enum of the profile's. */
function draftSchema(profiled: Profiled) {
  const sources = profiled.sources.map((s) => s.name);
  const columns = [...new Set(profiled.sources.flatMap((s) => s.columns.map((c) => c.name)))];
  const inclusions = profiled.inclusions.map((i) => i.id);
  const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
  return jsonSchema<Draft>({
    ...object(
      {
        types: {
          type: "array",
          minItems: 1,
          items: object(
            {
              name: { type: "string", pattern: NAME },
              source: { type: "string", enum: sources },
              key: { type: "string", enum: columns },
              fields: { type: "array", items: object({ name: { type: "string", pattern: MEMBER }, column: { type: "string", enum: columns } }, ["name", "column"]) },
            },
            ["name", "source", "key", "fields"],
          ),
        },
        edges:
          inclusions.length > 0
            ? {
                type: "array",
                items: object(
                  { name: { type: "string", pattern: MEMBER }, from: { type: "string", pattern: NAME }, to: { type: "string", pattern: NAME }, via: { type: "string", enum: inclusions } },
                  ["name", "from", "to", "via"],
                ),
              }
            : { type: "array", maxItems: 0, items: {} },
      },
      ["types", "edges"],
    ),
  } as Parameters<typeof jsonSchema>[0]);
}

/**
 * The Task, for one profile: its safe defaults are the profile's, so the decisions they settle are
 * taken as assumptions and the rest stop it as a question.
 */
export function modelTask(profiled: Profiled) {
  return defineTask<ModelInput, Draft, Profiled>({
    name: "model",
    context: (input) => input.profiled,
    instructions: MODEL,
    prompt: (input, p) =>
      [
        `What the data is about: ${input.about.trim() || "(not said)"}`,
        "Files:",
        ...p.sources.map(described),
        p.inclusions.length > 0 ? "Inclusions (every value of the first column is a value of the second):" : "No inclusions: there are no edges.",
        ...p.inclusions.map((i) => `- ${i.id}`),
      ].join("\n"),
    output: (_, p) => draftSchema(p),
    target: () => ({ set: "" }),
    verify: [columnsExist, keysUnique, edgesBacked, namesDistinct, ambiguities],
    decide: defaultsOf(profiled),
  });
}

// ── The draft, accepted ─────────────────────────────────────────────────────

/** A field of an accepted type: a column, with what the profile says of it. */
export interface AcceptedField {
  name: string;
  column: string;
  primitive: Source["columns"][number]["primitive"];
  optional: boolean;
}

/** A type, once its decisions are taken: what `mapping` declares and `requirements` asks over. */
export interface AcceptedType {
  name: string;
  source: string;
  /** The columns that identify one: a key, or a link file's two ends. */
  identity: string[];
  fields: AcceptedField[];
}

/** An edge, with where its values are: `column` of `on`, reached through `join` when there is one. */
export interface AcceptedEdge {
  name: string;
  from: string;
  to: string;
  /** The file holding the `to`'s key, and the column it is in. */
  on: string;
  column: string;
  /** For an edge across a link file: the link's column holding the `from`'s key. */
  join?: { column: string };
  /** Zero or more per `from`: across a link file. */
  many: boolean;
  /** Some `from` has none: the column has nulls. */
  optional: boolean;
}

export interface Accepted {
  types: AcceptedType[];
  edges: AcceptedEdge[];
}

/**
 * The draft with every decision taken — `option(id)` the option a decision stands at — or `null`
 * while one with no default is still open. A link file counted on its own becomes a type of its
 * own, identified by its two ends, with an edge to each.
 */
export function accept(draft: Draft, profiled: Profiled, option: (decision: string) => string | null): Accepted | null {
  if (decisionsOf(draft, profiled).some((d) => option(d.id) === null)) return null;
  const columnOf = (source: string, column: string) => sourceNamed(profiled, source)?.columns.find((c) => c.name === column);
  const field = (source: string, f: { name: string; column: string }): AcceptedField[] => {
    const c = columnOf(source, f.column);
    return c ? [{ name: f.name, column: f.column, primitive: c.primitive, optional: c.nulls > 0 }] : [];
  };
  const types: AcceptedType[] = draft.types.map((t) => {
    const chosen = option(keyDecision(t.source));
    const key = chosen && !draft.edges.some((e) => e.to === t.name) ? chosen : t.key;
    return { name: t.name, source: t.source, identity: [key], fields: t.fields.flatMap((f) => field(t.source, f)) };
  });
  const edges: AcceptedEdge[] = [];
  const things = new Map<string, AcceptedType>();
  for (const edge of draft.edges) {
    const backed = backing(edge, draft, profiled);
    if (!backed) continue;
    const { inclusion } = backed;
    const nulls = (columnOf(inclusion.from.source, inclusion.from.column)?.nulls ?? 0) > 0;
    if (backed.kind === "direct") {
      edges.push({ name: edge.name, from: edge.from, to: edge.to, on: inclusion.from.source, column: inclusion.from.column, many: false, optional: nulls });
      continue;
    }
    const link = inclusion.from.source;
    if (option(countDecision(link)) !== "thing") {
      edges.push({ name: edge.name, from: edge.from, to: edge.to, on: link, column: inclusion.from.column, join: { column: backed.back.from.column }, many: true, optional: true });
      continue;
    }
    // A thing of its own: a row of the link file, identified by the two ends it links.
    let thing = things.get(link);
    if (!thing) {
      const source = sourceNamed(profiled, link)!;
      const ends = [backed.back.from.column, inclusion.from.column];
      const taken = new Set(draft.types.map((t) => t.name));
      let name = pascal(singular(spoken(link)));
      for (let n = 2; taken.has(name); n++) name = `${pascal(singular(spoken(link)))}${n}`;
      thing = {
        name,
        source: link,
        identity: ends,
        fields: source.columns.filter((c) => !ends.includes(c.name)).flatMap((c) => field(link, { name: camel(pascal(spoken(c.name))), column: c.name })),
      };
      things.set(link, thing);
      types.push(thing);
      edges.push({ name: camel(edge.from), from: name, to: edge.from, on: link, column: backed.back.from.column, many: false, optional: false });
    }
    edges.push({ name: camel(edge.to), from: thing.name, to: edge.to, on: link, column: inclusion.from.column, many: false, optional: false });
  }
  return { types, edges };
}

// ── What the person reads ───────────────────────────────────────────────────

/**
 * How the accepted types hang together, one sentence per type with one real row: *each award has a
 * laureate, a year and a category — e.g. Marie Curie · 1903 · Physics*. An edge's value is its other
 * end, looked up across the files' sample rows through the column it lands on.
 */
export function relationsOf(accepted: Accepted, profiled: Profiled): Relation[] {
  const typeNamed = (name: string) => accepted.types.find((t) => t.name === name);
  /** The row of `type` whose identity is `value`, from its file's sample. */
  const find = (type: AcceptedType, value: string | null) => {
    const source = sourceNamed(profiled, type.source);
    if (!source || value === null) return undefined;
    return rowsOf(source).find((r) => r[type.identity[0]!] === value);
  };
  /** What a row of `type` is called: its first text field, else its identity. */
  const display = (type: AcceptedType, row: Record<string, string | null>) => {
    const named = type.fields.find((f) => f.primitive === "string" && row[f.column] != null);
    return named ? row[named.column]! : type.identity.map((c) => row[c]).join("–");
  };

  return accepted.types.flatMap((type): Relation[] => {
    const source = sourceNamed(profiled, type.source);
    if (!source) return [];
    const out = accepted.edges.filter((e) => e.from === type.name);
    const fields = type.fields.filter((f) => !type.identity.includes(f.column) && !out.some((e) => e.column === f.column));
    const parts = [...out.map((e) => ({ edge: e })), ...fields.map((f) => ({ field: f }))].slice(0, 4);
    if (parts.length === 0) return [];
    const said = parts.map((p) => ("edge" in p ? (p.edge.many ? plural(spoken(p.edge.name)) : withArticle(spoken(p.edge.name))) : withArticle(spoken(p.field.name))));

    const valueOf = (row: Record<string, string | null>, part: (typeof parts)[number]): string | null => {
      if ("field" in part) return row[part.field.column] ?? null;
      const { edge } = part;
      const to = typeNamed(edge.to);
      if (!to) return null;
      let value: string | null | undefined = row[edge.column];
      if (edge.join) {
        // Across a link file: the first link of this row, and its other end.
        const link = sourceNamed(profiled, edge.on);
        const ofThis = (link ? rowsOf(link) : []).find((r) => r[edge.join!.column] === row[type.identity[0]!]);
        value = ofThis?.[edge.column];
      }
      const end = find(to, value ?? null);
      return end ? display(to, end) : null;
    };
    const rows = rowsOf(source);
    const full = rows.map((row) => parts.map((p) => valueOf(row, p))).find((values) => values.every((v) => v !== null));
    return [
      {
        id: `relation/${type.name}`,
        sentence: `Each ${spoken(type.name)} has ${listed(said)}`,
        example: full ? (full as string[]) : null,
      },
    ];
  });
}
