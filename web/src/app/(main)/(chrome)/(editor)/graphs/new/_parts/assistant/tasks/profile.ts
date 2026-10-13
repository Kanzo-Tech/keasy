/**
 * **The profile, as the Tasks read it** — the `compute` step every Task's context is drawn from
 * (docs/design/assistant.md, *The three Tasks*). fossil's `profile()` answers per source key; here
 * each source is named by its binding, the name a program and a prompt write, and each inclusion
 * gets an id the model can pick from a closed list. Nothing here asks a model.
 */

import type { Input, Primitive, Profile } from "@fossil-lang/types";
import { bindingName } from "../../sources";

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
  format: string;
  /** The reader option the binding wrote (`delimiter = "|"`), verbatim. */
  option?: string;
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
export const inclusionId = (from: { source: string; column: string }, to: { source: string; column: string }) =>
  `${from.source}.${from.column} → ${to.source}.${to.column}`;

/** The last segment of a reference: `@nobel/data/laureates.csv` → `laureates.csv`. */
const fileOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);

/**
 * The profile, named by binding: each described source with its columns, counts, keys and sample,
 * and each inclusion between two of them. Two bindings that would collide get a numeric suffix, so
 * every name is one source.
 */
export function profiledOf(profile: Profile, inputs: readonly Input[]): Profiled {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const s of profile.sources) {
    const key = s.descriptor.key;
    const base = inputs.find((i) => i.key === key)?.binding ?? bindingName(fileOf(key));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    names.set(key, name);
  }
  const sources = profile.sources.map((s): Source => {
    const key = s.descriptor.key;
    const input = inputs.find((i) => i.key === key);
    return {
      name: names.get(key)!,
      key,
      file: fileOf(key),
      format: input?.format ?? "csv",
      option: input?.option,
      columns: s.descriptor.columns.map((c) => {
        const stats = s.columns.find((x) => x.name === c.name);
        return { name: c.name, primitive: c.primitive, nulls: stats?.nulls ?? 0, distinct: stats?.distinct ?? 0 };
      }),
      rows: s.sampled || s.rows === undefined ? null : s.rows,
      keys: s.keys,
      sample: s.sample,
    };
  });
  const inclusions = profile.inclusions.flatMap((i): Inclusion[] => {
    const from = names.get(i.from.source);
    const to = names.get(i.to.source);
    if (!from || !to) return [];
    const at = { from: { source: from, column: i.from.column }, to: { source: to, column: i.to.column } };
    return [{ id: inclusionId(at.from, at.to), ...at }];
  });
  return { sources, inclusions };
}

/** The `delimiter = "…"` a binding's option wrote, which a vocabulary carries apart. */
export function delimiterOf(option: string | undefined): string | undefined {
  const m = option?.match(/delimiter\s*=\s*"((?:[^"\\]|\\.)*)"/);
  return m ? m[1]!.replace(/\\(.)/g, "$1") : undefined;
}

/** A source's row as a record, column by column. */
export function rowOf(source: Source, row: readonly (string | null)[]): Record<string, string | null> {
  return Object.fromEntries(source.columns.map((c, i) => [c.name, row[i] ?? null]));
}

/** The source named `name`. */
export const sourceNamed = (profiled: Profiled, name: string) => profiled.sources.find((s) => s.name === name);
