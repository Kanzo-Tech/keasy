/**
 * **The profile, as the Tasks read it** — the `compute` step every Task's context is drawn from
 * (docs/design/assistant.md, *The three Tasks*). Each source is named by its binding, the name a
 * program and a prompt write, as fossil's `profile()` names it, and each inclusion gets an id the
 * model can pick from a closed list. Nothing here asks a model.
 */

import type { Primitive, Profile } from "@fossil-lang/types";
import { splitWords } from "@kanzo-tech/relations";

/** One column of a source, with what the profile counted of it. */
export interface Column {
  name: string;
  primitive: Primitive;
  /** Nulls over the rows read: a field over it is `Option<…>` when there are any. */
  nulls: number;
  distinct: number;
}

/** One picked file, profiled. */
export interface Source {
  /** The binding every reference to it is qualified by: `laureates`. */
  name: string;
  /** The reference as the program writes it — what the profile is keyed by. */
  key: string;
  /** The file's own name, for the person: `laureates.csv`. */
  file: string;
  columns: readonly Column[];
  /** How many rows it has, when the profile read every one; `null` when it read a sample. */
  rows: number | null;
  /** The columns that are candidate keys, in the profile's order. */
  keys: readonly string[];
  /** Its first rows, every cell as text, in `columns`' order. */
  sample: readonly (readonly (string | null)[])[];
}

/** Every value of `from` is a value of `to`, a candidate key: the shape of an edge. */
export interface Inclusion {
  /** `awards.laureate_id → laureates.id`: what the model picks it by. */
  id: string;
  from: { source: string; column: string };
  to: { source: string; column: string };
}

/** The picked files as the Tasks read them. */
export interface Profiled {
  sources: readonly Source[];
  inclusions: readonly Inclusion[];
}

/** `a.b → c.d`. */
const inclusionId = (from: { source: string; column: string }, to: { source: string; column: string }) =>
  `${from.source}.${from.column} → ${to.source}.${to.column}`;

/** The last segment of a reference: `@nobel/data/laureates.csv` → `laureates.csv`. */
const fileOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);

/**
 * The profile as the Tasks read it: each described source, named by its binding, with its columns,
 * counts, keys and sample, and each inclusion between two of them. fossil names every source by its
 * binding, so a binding is one source and the inclusions name the same.
 */
export function profiledOf(profile: Profile): Profiled {
  const sources = profile.sources.map((s): Source => {
    const key = s.descriptor.key;
    return {
      name: s.binding,
      key,
      file: fileOf(key),
      columns: s.descriptor.columns.map((c) => {
        const stats = s.columns.find((x) => x.name === c.name);
        return { name: c.name, primitive: c.primitive, nulls: stats?.null_count ?? 0, distinct: stats?.distinct_count ?? 0 };
      }),
      rows: s.sampled || s.rows === undefined ? null : s.rows,
      keys: s.candidate_keys,
      sample: s.sample,
    };
  });
  const named = new Set(sources.map((s) => s.name));
  const inclusions = profile.inclusions.flatMap((i): Inclusion[] =>
    named.has(i.from.source) && named.has(i.to.source) ? [{ id: inclusionId(i.from, i.to), from: i.from, to: i.to }] : [],
  );
  return { sources, inclusions };
}

/** A source's sample rows as records, column by column. */
export function rowsOf(source: Source): Record<string, string | null>[] {
  return source.sample.map((row) => Object.fromEntries(source.columns.map((c, i) => [c.name, row[i] ?? null])));
}

/** The values of `column` in a source's sample rows, empty ones left out. */
export const valuesOf = (source: Source, column: string) =>
  rowsOf(source).flatMap((row) => (row[column] == null ? [] : [row[column]]));

/** The source named `name`. */
export const sourceNamed = (profiled: Profiled, name: string) => profiled.sources.find((s) => s.name === name);

/** "nobel_laureates.csv" → "Nobel laureates": a file's name as a thing's, until `model` names it. */
export function thingName(file: string): string {
  const words = splitWords(file.replace(/\.[^.]*$/, ""));
  return words ? words[0]!.toUpperCase() + words.slice(1) : file;
}
