/**
 * **The requirements** — docs/design/assistant.md, *The three steps, and the one Task*. The questions a person could
 * ask of the graph the accepted model will be, offered as chips: Ask's specs written from the model,
 * not by a model — a count by a field, a count by the thing an edge reaches — each kept only if Ask's
 * oracles hold it over the join graph the accepted model will be, and asked as that spec. A question
 * the person types is the preview's Ask's: that is the one place a model reads it.
 */

import { type JoinGraph, type MappingModel, splitWords, withMapping } from "@kanzo-tech/relations";
import { ask, type AskSpec } from "@kanzo-tech/ai/data";
import { verify } from "@kanzo-tech/ai/task";
import type { Primitive } from "@fossil-lang/types";
import type { Accepted } from "./model";

/** A question on offer: its words, and Ask's spec, which the preview asks with no model. */
export interface Requirement {
  text: string;
  spec: AskSpec;
}

/** The DuckDB type a field of a primitive is read as, in the graph the accepted model will write. */
const DUCKDB: Record<Primitive, string> = {
  string: "VARCHAR",
  integer: "BIGINT",
  float: "DOUBLE",
  bool: "BOOLEAN",
  date: "DATE",
  date_time: "TIMESTAMP",
  time: "TIME",
  g_year: "INTEGER",
  any_uri: "VARCHAR",
  lang_string: "VARCHAR",
};

/**
 * The graph the accepted model will be, as Ask joins it, described by `mapping` — the RML mapping
 * fossil makes of the model's types before any run (`mappingOf`), so each type, column and edge carries
 * the class, the predicate, the datatype and the term type the built graph's mapping will state
 * (`withMapping`, as `GraphScope` describes a built graph). What a mapping does not state is the
 * tables' shape, so that much is the accepted model's: a table per type, its key an identity and its
 * fields typed as DuckDB will read them, and one table per edge, each named as fossil's run names it.
 */
export function joinGraphOf(accepted: Accepted, mapping: MappingModel): JoinGraph {
  return withMapping(tablesOf(accepted), mapping);
}

function tablesOf(accepted: Accepted): JoinGraph {
  return {
    types: accepted.types.map((t) => ({
      name: t.name,
      table: t.name,
      key: "id",
      columns: [{ name: "id", type: "VARCHAR", role: "identity" }, ...t.fields.map((f) => ({ name: f.name, type: DUCKDB[f.primitive] }))],
    })),
    edges: accepted.edges.map((e) => {
      const name = `${e.from}_${e.name}_${e.to}`;
      return { name, label: e.name, source: e.from, destination: e.to, table: name, src: "src", dst: "dst" };
    }),
  };
}

/** The most chips on offer. */
const OFFERED = 4;

/** Fields a breakdown by is no answer: one value per thing. */
const NAMING = /^(name|title|label|description|url|email|id)$/i;

/** How many bars the thing an edge reaches most keeps. */
const TOP = 10;

/** A type's words opening a sentence: `Award`, `Flight route`. */
const opening = (type: string) => splitWords(type).replace(/^./, (c) => c.toUpperCase());

/** A count of `of` by `x`, as a bar chart: Ask's spec, with no condition. */
const countBy = (of: string, x: string, top?: number): AskSpec => ({
  of,
  show: { kind: "chart", type: "bar", x, y: { op: "count" } },
  ...(top === undefined ? {} : { top }),
});

/**
 * The questions to start from, written from `accepted` as Ask's specs: for each edge one thing
 * reaches, a count of the things by the one they reach (*Award count by laureate*), and for each type
 * a count by its first date or category-like field (*Award count by category*). A name is said as
 * given, never inflected. Each is kept only if Ask's own oracles hold it over `graph`, as the
 * preview will ask it: its answer is known before it is asked, and no model reads it.
 */
export async function offersOf(accepted: Accepted, graph: JoinGraph): Promise<Requirement[]> {
  const label = (type: string) => accepted.types.find((t) => t.name === type)?.fields.find((f) => NAMING.test(f.name) && f.primitive === "string")?.name;
  const offers: Requirement[] = [];
  for (const e of accepted.edges.filter((x) => !x.many)) {
    const named = label(e.to);
    if (named) offers.push({ text: `${opening(e.from)} count by ${splitWords(e.name).toLowerCase()}`, spec: countBy(e.from, `${e.name}.${named}`, TOP) });
  }
  for (const t of accepted.types) {
    const by =
      t.fields.find((f) => ["date", "g_year", "date_time"].includes(f.primitive)) ??
      t.fields.find((f) => f.primitive === "string" && !NAMING.test(f.name));
    if (by) offers.push({ text: `${opening(t.name)} count by ${splitWords(by.name).toLowerCase()}`, spec: countBy(t.name, by.name) });
  }
  const held = await Promise.all(offers.map(async (o) => (await verify(ask, o.spec, { question: o.text, graph })).ok));
  return offers.filter((_, i) => held[i]).slice(0, OFFERED);
}
