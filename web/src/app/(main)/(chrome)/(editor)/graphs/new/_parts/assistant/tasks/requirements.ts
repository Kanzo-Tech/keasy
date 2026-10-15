/**
 * **The `requirements` Task** — docs/design/assistant.md, *The three Tasks*. The questions a
 * person could ask of the graph the accepted model will be, offered as chips, and whether a question
 * the person typed can be answered. The oracle is Ask's own: a question names what it counts and the
 * paths it reads from there, as Ask's model writes them (`affiliation.name`, `^laureate.name`), and
 * `JoinResolver` over the join graph of the accepted model reaches each one or says why not; a typed
 * question is put through Ask's Task, `ask`, as Discover will put it.
 */

import { jsonSchema, type LanguageModel } from "ai";
import { type JoinGraph, JoinResolver } from "@kanzo-tech/relations";
import { ask, type AskInput } from "@kanzo-tech/ai/data";
import { defineTask, type Finding, runTask } from "@kanzo-tech/ai/task";
import type { Primitive } from "@fossil-lang/types";
import type { Accepted } from "./model";

/** A question, as the model offers it: what it counts and the paths it reads from there. */
export interface Requirement {
  text: string;
  /** The type it counts or describes. */
  of: string;
  /** The fields it reads, each a path from `of`: `category`, `laureate.affiliation.name`. */
  fields: string[];
}

export interface RequirementsInput {
  accepted: Accepted;
  about: string;
}

/** The names a question may read: each type, and the paths from each. */
export interface RequirementsContext {
  types: string[];
  /** Each type's paths, two links out at most. */
  paths: Record<string, readonly string[]>;
}

/** How far from what it counts a question reads: a field of the type, across one link, or two. */
const HOPS = 2;

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
 * The graph the accepted model will be, as Ask joins it: a table per type, its key an identity and
 * its fields described by their type, and one table per edge. Written by hand because nothing has run
 * yet; the graph a run writes is read as `readJoinGraph` reads it.
 */
export function joinGraphOf(accepted: Accepted): JoinGraph {
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

/** Ask's word: each path is one the joins reach from what the question counts. */
function answerable(value: Requirement, input: RequirementsInput): Finding | undefined {
  if (!value.text.trim()) return { code: "requirements/empty", at: "/text", message: "A question has words." };
  const resolver = new JoinResolver(joinGraphOf(input.accepted));
  const missed = value.fields.filter((path) => "code" in resolver.field({ root: value.of, path: [] }, path));
  if (missed.length === 0) return undefined;
  return {
    code: "requirements/unreachable",
    at: "/fields",
    message: `${value.text}: nothing in these files reaches ${missed.join(", ")} from ${value.of}.`,
  };
}

const REQUIREMENTS = `You suggest questions a person could ask of their data once it is a graph, in their own words and in plain language.
Each names the type it counts or describes (of) and the fields it reads, each a path from that type: a field of it (name), or across its links (affiliation.name). Ask only what these paths can answer: a count, a breakdown, a ranking, or something across a link.`;

export const requirements = defineTask<RequirementsInput, Requirement, RequirementsContext>({
  name: "requirements",
  context: ({ accepted }) => {
    const resolver = new JoinResolver(joinGraphOf(accepted));
    const types = accepted.types.map((t) => t.name);
    return { types, paths: Object.fromEntries(types.map((t) => [t, resolver.paths(t, HOPS).filter((p) => p !== "id" && !p.endsWith(".id"))])) };
  },
  instructions: REQUIREMENTS,
  prompt: (input, context) =>
    [
      `What the data is about: ${input.about.trim() || "(not said)"}`,
      "What links the types:",
      ...input.accepted.edges.map((e) => `- ${e.from}.${e.name} links to ${e.to}${e.many ? `, several per ${e.from}` : ""}`),
      "Each type, and the paths a question about it may read:",
      ...context.types.map((t) => `- ${t}: ${context.paths[t]!.join(", ")}`),
    ].join("\n"),
  output: (_, context) =>
    jsonSchema<Requirement>({
      type: "object",
      properties: {
        text: { type: "string", description: "The question, as the person would ask it." },
        of: { type: "string", enum: context.types },
        fields: { type: "array", items: { type: "string", enum: [...new Set(Object.values(context.paths).flat())] } },
      },
      required: ["text", "of", "fields"],
      additionalProperties: false,
    }),
  target: () => ({ add: "/questions" }),
  verify: [answerable],
});

// ── A question the person typed ─────────────────────────────────────────────

/** Ask's input for `question` over the accepted model: its join graph, which says what each field is. */
export function askInputOf(question: string, accepted: Accepted): AskInput {
  return { question, graph: joinGraphOf(accepted) };
}

/**
 * Whether these files can answer `question`: Ask's Task, run over the accepted model as Discover
 * will run it — answerable when its spec holds, or holds but for a decision Ask asks the person
 * back. A spec the oracles still refuse after Ask's own repairs is not.
 */
export async function isAnswerable(
  question: string,
  accepted: Accepted,
  { model, signal }: { model: LanguageModel; signal?: AbortSignal },
): Promise<boolean> {
  const proposal = await runTask(ask, askInputOf(question, accepted), { model, signal });
  return proposal.verdict.ok || "decision" in proposal.verdict;
}
