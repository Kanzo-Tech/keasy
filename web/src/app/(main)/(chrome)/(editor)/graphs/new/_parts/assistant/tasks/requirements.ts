/**
 * **The requirements** — docs/design/assistant.md, *The three Tasks*. The questions a person could
 * ask of the graph the accepted model will be, offered as chips, and whether a question the person
 * typed can be answered. The chips are written from the model, not by a model — a count by a field,
 * the thing an edge reaches most — and each is kept only if Ask's resolver reaches every path it
 * reads (`affiliation.name`) over the join graph the accepted model will be. A typed question is put
 * through Ask's Task, `ask`, as Discover will put it: that is the one place a model reads it.
 */

import type { LanguageModel } from "ai";
import { type JoinGraph, JoinResolver, type MappingModel, splitWords, withMapping } from "@kanzo-tech/relations";
import { ask } from "@kanzo-tech/ai/data";
import { runTask } from "@kanzo-tech/ai/task";
import type { Primitive } from "@fossil-lang/types";
import type { Accepted } from "./model";

/** A question on offer: what it counts and the paths it reads from there. */
export interface Requirement {
  text: string;
  /** The type it counts or describes. */
  of: string;
  /** The fields it reads, each a path from `of`: `category`, `laureate.affiliation.name`. */
  fields: string[];
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

/** `Award` → `awards`, `Category` → `categories`. */
function plural(type: string): string {
  const words = splitWords(type).toLowerCase();
  if (/[^aeiou]y$/.test(words)) return `${words.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(words)) return `${words}es`;
  return `${words}s`;
}

/**
 * The questions to start from, written from `accepted`: for each edge one thing reaches, which of
 * them has the most (*Which laureate has the most awards?*), and for each type a count by its first
 * date or category-like field (*How many awards are there by year?*). Each kept only if `graph`'s
 * resolver reaches what it reads.
 */
export function offersOf(accepted: Accepted, graph: JoinGraph): Requirement[] {
  const resolver = new JoinResolver(graph);
  const reaches = (r: Requirement) => r.fields.every((path) => !("code" in resolver.field({ root: r.of, path: [] }, path)));
  const label = (type: string) => accepted.types.find((t) => t.name === type)?.fields.find((f) => NAMING.test(f.name) && f.primitive === "string")?.name;
  const offers: Requirement[] = [];
  for (const e of accepted.edges.filter((x) => !x.many)) {
    const named = label(e.to);
    if (!named) continue;
    offers.push({ text: `Which ${splitWords(e.to).toLowerCase()} has the most ${plural(e.from)}?`, of: e.from, fields: [`${e.name}.${named}`] });
  }
  for (const t of accepted.types) {
    const by =
      t.fields.find((f) => ["date", "g_year", "date_time"].includes(f.primitive)) ??
      t.fields.find((f) => f.primitive === "string" && !NAMING.test(f.name));
    if (by) offers.push({ text: `How many ${plural(t.name)} are there by ${splitWords(by.name).toLowerCase()}?`, of: t.name, fields: [by.name] });
  }
  return offers.filter(reaches).slice(0, OFFERED);
}

// ── A question the person typed ─────────────────────────────────────────────

/**
 * Whether these files can answer `question`: Ask's Task, run over `graph` (`joinGraphOf`) as Discover
 * will run it — answerable when its spec holds, or holds but for a decision Ask asks the person
 * back. A spec the oracles still refuse after Ask's own repairs is not.
 */
export async function isAnswerable(
  question: string,
  graph: JoinGraph,
  { model, signal }: { model: LanguageModel; signal?: AbortSignal },
): Promise<boolean> {
  const proposal = await runTask(ask, { question, graph }, { model, signal });
  return proposal.verdict.ok || "decision" in proposal.verdict;
}
