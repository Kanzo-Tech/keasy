/**
 * **The model** — docs/design/assistant.md, *`model` — structure from the profile*. The structure is fossil's profile, computed and never proposed: a thing per file with a
 * key, that key its first candidate (or the one an inclusion lands on), an edge per inclusion that
 * lands on a key, and a file with no key of its own whose two inclusions link two things a bridge —
 * an edge across it, not a thing. Valid by construction. The names are the files' own words too
 * (`namesOf`): a model asked to name every slot did not fit the on-device model's context even for
 * Nobel, and what it added over the files' words was little. What the profile cannot settle is a
 * `Decision`, raised here for the person.
 *
 * IRIs are not here: `mapping` computes them from the workspace and the names.
 */

import type { Decision } from "@kanzo-tech/ai/task";
import type { Relation } from "../model";
import { type Inclusion, type Profiled, rowsOf, type Source, sourceNamed, valuesOf } from "./profile";
import { splitWords } from "@kanzo-tech/relations";

// ── The structure, from the profile ─────────────────────────────────────────

/** A thing the data holds: a file with a key. */
export interface StructureType {
  source: string;
  key: string;
  /** The columns it keeps as fields: all but its key and the ones its edges leave from. */
  columns: string[];
}

/** An edge: `from` and `to` are sources, `via` the inclusion landing on `to`'s key, `across` a bridge. */
export interface StructureEdge {
  via: string;
  from: string;
  to: string;
  across?: string;
}

export interface Structure {
  types: StructureType[];
  edges: StructureEdge[];
}

/**
 * The structure the profile states. A file with a candidate key is a thing, keyed by the key an
 * inclusion lands on when one does (an edge fixes its key), else by its first; an inclusion between
 * two things on that key is an edge; a file with no key whose two inclusions land on things' keys is
 * a bridge between them. A file that is neither is left out: nothing identifies one of its rows.
 */
export function structureOf(profiled: Profiled): Structure {
  const keyOf = new Map<string, string>();
  for (const source of profiled.sources) {
    if (source.keys.length === 0) continue;
    const landed = profiled.inclusions.find((i) => i.to.source === source.name && source.keys.includes(i.to.column));
    keyOf.set(source.name, landed?.to.column ?? source.keys[0]!);
  }
  const lands = (i: Inclusion) => keyOf.get(i.to.source) === i.to.column;
  const edges: StructureEdge[] = profiled.inclusions
    .filter((i) => keyOf.has(i.from.source) && lands(i))
    .map((i) => ({ via: i.id, from: i.from.source, to: i.to.source }));
  for (const source of profiled.sources) {
    if (keyOf.has(source.name)) continue;
    const out = profiled.inclusions.filter((i) => i.from.source === source.name && lands(i));
    if (out.length !== 2) continue;
    const [back, via] = out as [Inclusion, Inclusion];
    edges.push({ via: via.id, from: back.to.source, to: via.to.source, across: source.name });
  }
  const types = profiled.sources.flatMap((source): StructureType[] => {
    const key = keyOf.get(source.name);
    if (key === undefined) return [];
    const leaving = profiled.inclusions.filter((i) => i.from.source === source.name && edges.some((e) => e.via === i.id)).map((i) => i.from.column);
    return [{ source: source.name, key, columns: source.columns.map((c) => c.name).filter((c) => c !== key && !leaving.includes(c)) }];
  });
  return { types, edges };
}

// ── The artefact ────────────────────────────────────────────────────────────

/** A name for every thing and edge of the structure (`namesOf`). */
export interface Names {
  /** Each thing's name, by its source: singular, PascalCase. */
  types: Record<string, string>;
  /** Each edge's name, by the inclusion it rides: what its `to` is to its `from`. */
  edges: Record<string, string>;
}

const RESERVED = ["from", "and", "or", "not", "true", "false", "null"];

/** A column's own words as a field's name: `birth_date` → `birthDate`; a word of Fossil's gets `Value`. */
export function fieldName(column: string): string {
  const name = camel(pascal(splitWords(column)));
  const member = /^[a-z]/.test(name) ? name : `f${name}`;
  return RESERVED.includes(member) ? `${member}Value` : member;
}

/** A thing, named. */
export interface DraftType {
  /** Singular: `Laureate`. */
  name: string;
  /** The file it stands on: a source's binding. */
  source: string;
  /** The column that identifies one: a candidate key of `source`. */
  key: string;
  /** The columns it keeps, each under its field's name (`fieldName`). */
  fields: { name: string; column: string }[];
}

/** A link between two things, backed by an inclusion of the profile. */
export interface DraftEdge {
  /** What one is to the other: `laureate`. */
  name: string;
  from: string;
  to: string;
  /** The inclusion that backs it, by its id. */
  via: string;
}

/** The structure with its names: what the decisions, `accept` and the person read. */
export interface Draft {
  types: DraftType[];
  edges: DraftEdge[];
}

/** The structure, named. A slot the names leave out keeps its file's or column's own name. */
export function draftOf(structure: Structure, names: Names): Draft {
  const typeName = (source: string) => names.types[source] ?? source;
  return {
    types: structure.types.map((t) => ({
      name: typeName(t.source),
      source: t.source,
      key: t.key,
      fields: t.columns.map((column) => ({ name: fieldName(column), column })),
    })),
    edges: structure.edges.map((e) => ({ name: names.edges[e.via] ?? e.to, from: typeName(e.from), to: typeName(e.to), via: e.via })),
  };
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
      question: `Which column tells one ${splitWords(type.name)} from another?`,
      options: source.keys.map((k) => ({ id: k, label: splitWords(k), detail: exampleOf(source, k) })),
    });
  }
  const linked = new Set<string>();
  for (const edge of draft.edges) {
    const backed = backing(edge, draft, profiled);
    if (backed?.kind !== "link" || linked.has(backed.inclusion.from.source)) continue;
    const link = backed.inclusion.from.source;
    linked.add(link);
    const [from, to] = [splitWords(edge.from), splitWords(edge.to)];
    decisions.push({
      id: countDecision(link),
      question: `Each row of ${link} links ${from} to ${to}. Is a row only that link, or a thing counted on its own?`,
      options: [
        { id: "link", label: `Only a link: ${from} → ${to}`, detail: `${link} only links them` },
        { id: "thing", label: `A thing of its own: ${splitWords(link)}`, detail: `counted on its own` },
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

// ── The names ───────────────────────────────────────────────────────────────

/**
 * Every thing and edge named from the files' own words, with no model: a thing by its file, singular
 * (`affiliations` → `Affiliation`), an edge by the column it leaves from without its `_id`
 * (`laureate_id` → `laureate`). A name already taken in its scope gets a number.
 */
export function namesOf(structure: Structure): Names {
  const types: Record<string, string> = {};
  const taken = new Set<string>();
  for (const t of structure.types) {
    const base = pascal(singular(splitWords(t.source))) || "Thing";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    types[t.source] = name;
  }
  const edges: Record<string, string> = {};
  const members = new Map(structure.types.map((t) => [t.source, new Set(t.columns.map(fieldName))]));
  for (const e of structure.edges) {
    const column = e.via.slice(e.via.indexOf(".") + 1, e.via.indexOf(" → "));
    const words = splitWords(column).replace(/\s*\bid$/i, "").trim();
    const base = words ? fieldName(words) : camel(types[e.to]!);
    const own = members.get(e.from) ?? new Set<string>();
    let name = base;
    for (let n = 2; own.has(name); n++) name = `${base}${n}`;
    own.add(name);
    edges[e.via] = name;
  }
  return { types, edges };
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
      let name = pascal(singular(splitWords(link)));
      for (let n = 2; taken.has(name); n++) name = `${pascal(singular(splitWords(link)))}${n}`;
      thing = {
        name,
        source: link,
        identity: ends,
        fields: source.columns.filter((c) => !ends.includes(c.name)).flatMap((c) => field(link, { name: fieldName(c.name), column: c.name })),
      };
      things.set(link, thing);
      types.push(thing);
      edges.push({ name: camel(edge.from), from: name, to: edge.from, on: link, column: backed.back.from.column, many: false, optional: false });
    }
    edges.push({ name: camel(edge.to), from: thing.name, to: edge.to, on: link, column: inclusion.from.column, many: false, optional: false });
  }
  return { types, edges };
}

// ── Identifiers ─────────────────────────────────────────────────────────────

/** A file's name as a type's: `affiliations` → `affiliation`. */
function singular(noun: string): string {
  if (/ies$/i.test(noun)) return `${noun.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(noun)) return noun;
  if (/(xes|ches|shes|sses)$/i.test(noun)) return noun.slice(0, -2);
  return noun.replace(/s$/i, "");
}

/** `nobel affiliations` → `NobelAffiliations`. */
function pascal(words: string): string {
  return words
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

/** `Laureate` → `laureate`. */
const camel = (name: string) => (name ? name[0]!.toLowerCase() + name.slice(1) : name);

const list = new Intl.ListFormat("en-GB", { type: "conjunction" });

/** "a, b and c". */
export const listed = (items: readonly string[]) => list.format(items);

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
    const said = parts.map((p) => splitWords("edge" in p ? p.edge.name : p.field.name));

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
        sentence: `${splitWords(type.name)}: ${listed(said)}`,
        example: full ? (full as string[]) : null,
      },
    ];
  });
}
