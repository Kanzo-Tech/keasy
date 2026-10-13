/**
 * **The `requirements` Task** — docs/design/assistant.md, *The three Tasks*. The questions a
 * person could ask of the graph the accepted model will be, offered as chips, and whether a question
 * the person typed can be answered. The oracle is Ask's own: the resolver (`resolveRelation`) over
 * the join graph of the accepted model reaches every field a question reads from what it counts,
 * and a typed question is put through Ask's Task, `ask`, as Discover will put it.
 */

import { jsonSchema, type LanguageModel } from "ai";
import { resolveRelation, type JoinGraph } from "@kanzo-tech/mosaic";
import { ask, type AnswerField, type AnswerRelation, type AskInput } from "@kanzo-tech/ai/data";
import { defineTask, type Finding, runTask } from "@kanzo-tech/ai/task";
import type { Accepted } from "./model";
import { type Profiled, sourceNamed } from "./profile";

/** A question, as the model offers it: what it counts and the fields it reads. */
export interface Requirement {
  text: string;
  /** The type it counts or describes. */
  of: string;
  /** The fields it reads, `Type.field`. */
  fields: string[];
}

export interface RequirementsInput {
  accepted: Accepted;
  about: string;
}

/** The names a question may read: each type, and its fields as `Type.field`. */
export interface RequirementsContext {
  types: string[];
  fields: string[];
}

/** The graph the accepted model will be, as Ask joins it: a table per type, one per edge. */
export function joinGraphOf(accepted: Accepted): JoinGraph {
  return {
    types: accepted.types.map((t) => ({ name: t.name, table: t.name, key: "id", columns: t.fields.map((f) => f.name) })),
    edges: accepted.edges.map((e) => {
      const name = `${e.from}_${e.name}_${e.to}`;
      return { name, label: e.name, source: e.from, destination: e.to, table: name, src: "src", dst: "dst" };
    }),
  };
}

const typeOf = (field: string) => field.slice(0, field.indexOf("."));

/** The resolver's word: every field's type is reached from `of`. A tie is answerable — Ask asks it back. */
function answerable(value: Requirement, input: RequirementsInput): Finding | undefined {
  if (!value.text.trim()) return { code: "requirements/empty", at: "/text", message: "A question has words." };
  const resolved = resolveRelation(joinGraphOf(input.accepted), { root: value.of, types: [...new Set(value.fields.map(typeOf))] });
  if (resolved.kind !== "unreachable") return undefined;
  return {
    code: "requirements/unreachable",
    at: "/of",
    message: `${value.text}: nothing links ${value.of} to ${resolved.missing.join(", ")} in these files.`,
  };
}

const REQUIREMENTS = `You suggest questions a person could ask of their data once it is a graph, in their own words and in plain language.
Each names the type it counts or describes (of) and the fields it reads (Type.field). Ask only what these types and fields can answer: a count, a breakdown, a ranking, or something across a link.`;

export const requirements = defineTask<RequirementsInput, Requirement, RequirementsContext>({
  name: "requirements",
  context: ({ accepted }) => ({
    types: accepted.types.map((t) => t.name),
    fields: accepted.types.flatMap((t) => [...t.fields.map((f) => `${t.name}.${f.name}`), ...accepted.edges.filter((e) => e.from === t.name).map((e) => `${t.name}.${e.name}`)]),
  }),
  instructions: REQUIREMENTS,
  prompt: (input, context) =>
    [
      `What the data is about: ${input.about.trim() || "(not said)"}`,
      "Types, their fields, and what links them:",
      ...input.accepted.types.map((t) => `- ${t.name}: ${t.fields.map((f) => f.name).join(", ")}`),
      ...input.accepted.edges.map((e) => `- ${e.from}.${e.name} links to ${e.to}${e.many ? `, several per ${e.from}` : ""}`),
      `Fields: ${context.fields.join(", ")}`,
    ].join("\n"),
  output: (_, context) =>
    jsonSchema<Requirement>({
      type: "object",
      properties: {
        text: { type: "string", description: "The question, as the person would ask it." },
        of: { type: "string", enum: context.types },
        fields: { type: "array", items: { type: "string", enum: context.fields } },
      },
      required: ["text", "of", "fields"],
      additionalProperties: false,
    }),
  target: () => ({ add: "/questions" }),
  verify: [answerable],
});

// ── A question the person typed ─────────────────────────────────────────────

const KIND: Record<string, AnswerField["kind"]> = { integer: "numeric", float: "numeric", date: "temporal", date_time: "temporal", g_year: "temporal" };

/**
 * Ask's input for `question` over the accepted model: its join graph, and each type alone with its
 * fields as a dashboard over it reads them — a number a measure, a date a dimension in time, the
 * rest categories with the values the profile's sample holds.
 */
export function askInputOf(question: string, accepted: Accepted, profiled: Profiled): AskInput {
  const types = accepted.types.map((t): AnswerRelation => {
    const source = sourceNamed(profiled, t.source);
    const fields = t.fields.map((f): AnswerField => {
      const kind = KIND[f.primitive] ?? "categorical";
      const at = source?.columns.findIndex((c) => c.name === f.column) ?? -1;
      const values = at < 0 ? [] : [...new Set(source!.sample.map((r) => r[at]).filter((v): v is string => v != null))].slice(0, 6);
      return {
        name: `${t.name}.${f.name}`,
        type: f.primitive,
        kind,
        role: kind === "numeric" ? "measure" : "dimension",
        distinct: source?.columns[at]?.distinct ?? values.length,
        ...(kind === "categorical" && values.length > 0 ? { values } : {}),
      };
    });
    return { relation: { root: t.name, path: [] }, fields, columns: ["id", ...fields.map((f) => f.name)] };
  });
  return { question, graph: joinGraphOf(accepted), types };
}

/**
 * Whether these files can answer `question`: Ask's Task, run over the accepted model as Discover
 * will run it — answerable when its spec holds, or holds but for which way to count, which Ask asks
 * back. A spec the oracles still refuse after Ask's own repairs is not.
 */
export async function isAnswerable(
  question: string,
  accepted: Accepted,
  profiled: Profiled,
  { model, signal }: { model: LanguageModel; signal?: AbortSignal },
): Promise<boolean> {
  const proposal = await runTask(ask, askInputOf(question, accepted, profiled), { model, signal });
  return proposal.verdict.ok || "decision" in proposal.verdict;
}
