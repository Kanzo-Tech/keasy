/**
 * **The model** — docs/design/assistant.md, *`model` — structure from the profile*. The model is
 * fossil's: `infer` reads the profile into the types, their keys, the relations and the link files,
 * each named by the files' own words, and says what the profile cannot settle as an `Ambiguity`
 * standing at an answer. What is keasy's is the person: each ambiguity said as a question
 * (`decisionsOf`), which of them a safe default settles (`assumedOf`), and the sentence each type
 * reads as (`relationsOf`). Nothing here asks a model.
 *
 * IRIs are not here either: fossil's `write` makes them from the workspace and the names.
 */

import type { Ambiguity, Inferred, Model, ModelType } from "@fossil-lang/types";
import type { Decision } from "@kanzo-tech/ai/task";
import type { Relation } from "../model";
import { type Profiled, rowsOf, type Source, sourceNamed, valuesOf } from "./profile";
import { splitWords } from "@kanzo-tech/relations";

// ── The questions, from fossil's ambiguities ────────────────────────────────

/** A type's name as the person reads it: `NobelPrizes` → `nobel prizes`. */
const said = (name: string) => splitWords(name).toLowerCase();

/** The type read from `source` in `model`, by the person's words; the source itself when none is. */
const typeOn = (model: Model, source: string) => said(model.types.find((t) => t.source === source)?.name ?? source);

/**
 * Each of fossil's ambiguities as a question, in fossil's order: which column tells one thing from
 * another, whether a link file's row is only the link or a thing counted on its own, and which of
 * two columns keeps the one name they make. The ids are fossil's, so an answer goes back to `infer`
 * as it came.
 */
export function decisionsOf({ model, ambiguities }: Inferred, profiled: Profiled): Decision[] {
  return ambiguities.map((a): Decision => {
    const { about } = a;
    switch (about.kind) {
      case "key": {
        const source = sourceNamed(profiled, about.source);
        return {
          id: a.id,
          question: `Which column tells the ${typeOn(model, about.source)} apart?`,
          options: a.options.map((k) => ({ id: k, label: splitWords(k), detail: source && exampleOf(source, k) })),
        };
      }
      case "count": {
        const [from, to] = [said(about.from), said(about.to)];
        return {
          id: a.id,
          question: `Each row of ${about.source} links ${from} to ${to}. Is a row only that link, or a thing counted on its own?`,
          options: [
            { id: "link", label: `Only a link: ${from} → ${to}`, detail: `${about.source} only links them` },
            { id: "thing", label: `A thing of its own: ${splitWords(about.source)}`, detail: "counted on its own" },
          ],
        };
      }
      case "name":
        return {
          id: a.id,
          question: `Two columns of ${said(about.type)} would both be called ${about.name}. Which one keeps it?`,
          options: a.options.map((c) => ({ id: c, label: c })),
        };
    }
  });
}

/**
 * The option a safe default settles `ambiguity` with, or `null` when it is the person's to say. A
 * key and a shared name are settled by fossil's first option, said as an assumption the person can
 * change: any candidate key identifies a row, and either column is the data's. How a link file's row
 * is counted changes what the graph holds, so it is asked, and only the build waits on it.
 */
export const assumedOf = (ambiguity: Ambiguity): string | null =>
  ambiguity.about.kind === "count" ? null : (ambiguity.options[0] ?? null);

/** A source's first value of `column`: what an option's detail shows. */
function exampleOf(source: Source, column: string): string | undefined {
  const [value] = valuesOf(source, column);
  return value === undefined ? undefined : `e.g. ${value}`;
}

const list = new Intl.ListFormat("en-GB", { type: "conjunction" });

/** "a, b and c". */
export const listed = (items: readonly string[]) => list.format(items);

// ── What the person reads ───────────────────────────────────────────────────

/**
 * How the types hang together, one sentence per type with one real row: *each award has a
 * laureate, a year and a category — e.g. Marie Curie · 1903 · Physics*. An edge's value is its other
 * end, looked up across the files' sample rows through the column it lands on.
 */
export function relationsOf(model: Model, profiled: Profiled): Relation[] {
  const typeNamed = (name: string) => model.types.find((t) => t.name === name);
  /** The row of `type` whose identity is `value`, from its file's sample. */
  const find = (type: ModelType, value: string | null) => {
    const source = sourceNamed(profiled, type.source);
    if (!source || value === null) return undefined;
    return rowsOf(source).find((r) => r[type.identity[0]!] === value);
  };
  /** What a row of `type` is called: its first text field, else its identity. */
  const display = (type: ModelType, row: Record<string, string | null>) => {
    const named = type.fields.find((f) => f.primitive === "string" && row[f.column] != null);
    return named ? row[named.column]! : type.identity.map((c) => row[c]).join("–");
  };

  return model.types.flatMap((type): Relation[] => {
    const source = sourceNamed(profiled, type.source);
    if (!source) return [];
    const out = model.edges.filter((e) => e.from === type.name);
    const fields = type.fields.filter((f) => !type.identity.includes(f.column) && !out.some((e) => e.column === f.column));
    const parts = [...out.map((e) => ({ edge: e })), ...fields.map((f) => ({ field: f }))].slice(0, 4);
    if (parts.length === 0) return [];
    const words = parts.map((p) => splitWords("edge" in p ? p.edge.name : p.field.name));

    const valueOf = (row: Record<string, string | null>, part: (typeof parts)[number]): string | null => {
      if ("field" in part) return row[part.field.column] ?? null;
      const { edge } = part;
      const to = typeNamed(edge.to);
      if (!to) return null;
      let value: string | null | undefined = row[edge.column];
      if (edge.join) {
        // Across a link file: the first link of this row, and its other end.
        const link = sourceNamed(profiled, edge.on);
        const ofThis = (link ? rowsOf(link) : []).find((r) => r[edge.join!] === row[type.identity[0]!]);
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
        sentence: `${splitWords(type.name)}: ${listed(words)}`,
        example: full ? (full as string[]) : null,
      },
    ];
  });
}
